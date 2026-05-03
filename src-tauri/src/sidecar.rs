//! Python sidecar lifecycle.
//!
//! Spawns the Python sidecar (in dev: `uv run python -m sidecar.cli serve`;
//! in prod: the bundled PyInstaller binary), reads `PORT=NNNNN` from the
//! sidecar's stdout, then exposes typed methods to call its HTTP endpoints.
//!
//! `kill_on_drop(true)` is set so the OS reaps the child even if Sidecar is
//! dropped without explicit `kill()`. This is the "no zombie process" guarantee
//! the eng review's A2 fix requires (Tauri's externalBin gives the same on
//! Windows JobObject + Unix pgroup; tokio adds a userland safety net).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tracing::{debug, info, warn};

use crate::error::{Error, ErrorEnvelope, Result};
use crate::models::{Clip, ScoreData};

const SPAWN_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
// Long enough to cover worst-case first-run /ingest: a 15-min clip (cap) means
// download + ffmpeg normalize + lazy-import torch/whisper + transcribe. On CPU
// this can run 4-6 minutes. 10 minutes gives ~2x safety; below it = legit work,
// above it = the sidecar is hung and we should bail. /health overrides to 5s.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
}

impl SidecarConfig {
    /// Dev: invoke the venv's Python directly (NOT via `uv run`).
    ///
    /// `uv run` creates a uv parent + python grandchild tree. tokio's
    /// `kill_on_drop` only kills the direct child, leaving the python
    /// grandchild bound to the port — exactly the zombie scenario eng
    /// review A2 warns about. Calling python directly gives us a single
    /// process whose death is unambiguous.
    ///
    /// `sidecar_root` is typically `<repo>/sidecar/`. The venv must already
    /// exist there (created by `uv venv && uv pip install -e .[dev]`).
    pub fn dev_at(sidecar_root: PathBuf) -> Self {
        let venv_python = if cfg!(windows) {
            sidecar_root.join(".venv").join("Scripts").join("python.exe")
        } else {
            sidecar_root.join(".venv").join("bin").join("python")
        };
        Self {
            command: venv_python.to_string_lossy().into_owned(),
            args: ["-m", "sidecar.cli", "serve"]
                .iter().map(|s| s.to_string()).collect(),
            working_dir: Some(sidecar_root),
        }
    }

    /// Prod: a bundled PyInstaller binary that runs `serve` directly.
    /// Tauri's externalBin will use this with Windows JobObject + Unix
    /// process-group cleanup automatically.
    pub fn bundled(binary_path: PathBuf) -> Self {
        Self {
            command: binary_path.to_string_lossy().into_owned(),
            args: vec!["serve".to_string()],
            working_dir: None,
        }
    }
}

pub struct Sidecar {
    child: Child,
    port: u16,
    base_url: String,
    client: reqwest::Client,
}

impl Sidecar {
    pub async fn spawn(config: SidecarConfig) -> Result<Self> {
        info!(?config.command, ?config.args, "spawning sidecar");

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);
        if let Some(wd) = &config.working_dir {
            cmd.current_dir(wd);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());
        cmd.kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            Error::unreachable(format!(
                "failed to spawn sidecar with command '{}': {e}",
                config.command,
            ))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            Error::unreachable("sidecar spawned but stdout was not piped")
        })?;
        let mut reader = BufReader::new(stdout);

        let port = read_port_line(&mut reader, SPAWN_TIMEOUT).await?;
        info!(port, "sidecar port acquired");

        // Drain remaining stdout in the background. uvicorn defaults to
        // stderr for logs, so stdout normally has nothing more, but if
        // anything writes to stdout, we don't want the pipe buffer to fill
        // and block the sidecar.
        tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut reader, &mut sink).await;
        });

        let base_url = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()?;

        let sidecar = Self { child, port, base_url, client };

        // Don't return until /health responds. The sidecar prints PORT=NN
        // before uvicorn is fully ready in some cases.
        sidecar.wait_for_health(HEALTH_TIMEOUT).await?;
        info!(port, "sidecar healthy");

        Ok(sidecar)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    pub async fn health(&self) -> Result<()> {
        let url = format!("{}/health", self.base_url);
        let resp = self.client.get(&url)
            .timeout(HEALTH_TIMEOUT)
            .send().await
            .map_err(|e| Error::unreachable(format!("health request failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(Error::unreachable(format!(
                "health returned status {}",
                resp.status(),
            )));
        }
        Ok(())
    }

    /// Poll /health until success or timeout. Used during spawn.
    async fn wait_for_health(&self, timeout: Duration) -> Result<()> {
        let deadline = tokio::time::Instant::now() + timeout;
        let mut attempt = 0;
        loop {
            attempt += 1;
            match self.health().await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err(e);
                    }
                    debug!(attempt, "health not yet ready; retrying");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }

    pub async fn ingest_url(
        &self,
        url: &str,
        max_duration_s: i32,
        model_name: Option<&str>,
    ) -> Result<Clip> {
        let mut body = serde_json::json!({
            "source_uri": url,
            "kind": "url",
            "max_duration_s": max_duration_s,
        });
        if let Some(m) = model_name {
            body["model_name"] = serde_json::Value::String(m.to_string());
        }
        let resp = self.post_json("/ingest", &body).await?;
        parse_ingest(resp)
    }

    /// Ingest a trimmed window of a URL. Used after a CLIP_TOO_LONG error
    /// when the user picked a 15-min slice via the trim dialog.
    pub async fn ingest_url_trimmed(
        &self,
        url: &str,
        max_duration_s: i32,
        trim_start_s: f64,
        trim_end_s: f64,
        model_name: Option<&str>,
    ) -> Result<Clip> {
        let mut body = serde_json::json!({
            "source_uri": url,
            "kind": "url",
            "max_duration_s": max_duration_s,
            "trim": { "start_s": trim_start_s, "end_s": trim_end_s },
        });
        if let Some(m) = model_name {
            body["model_name"] = serde_json::Value::String(m.to_string());
        }
        let resp = self.post_json("/ingest", &body).await?;
        parse_ingest(resp)
    }

    /// Lightweight metadata probe — no download. Returns total duration in
    /// seconds and a display title. Used by the trim dialog.
    pub async fn probe_url(&self, url: &str) -> Result<ProbeResult> {
        let body = serde_json::json!({ "url": url });
        let resp = self.post_json("/probe", &body).await?;
        let raw: ProbeRawResponse = serde_json::from_value(resp)?;
        if raw.ok {
            Ok(ProbeResult {
                duration_s: raw.duration_s.unwrap_or(0.0),
                title: raw.title.unwrap_or_default(),
            })
        } else {
            Err(Error::Api(raw.error.unwrap_or_else(|| {
                ErrorEnvelope::new(
                    crate::error::ErrorCode::Internal,
                    "probe returned ok=false but no error envelope",
                )
            })))
        }
    }

    pub async fn ingest_file(
        &self,
        path: &str,
        max_duration_s: i32,
        model_name: Option<&str>,
    ) -> Result<Clip> {
        let mut body = serde_json::json!({
            "source_uri": format!("file://{}", path),
            "kind": "file",
            "max_duration_s": max_duration_s,
        });
        if let Some(m) = model_name {
            body["model_name"] = serde_json::Value::String(m.to_string());
        }
        let resp = self.post_json("/ingest", &body).await?;
        parse_ingest(resp)
    }

    /// Render text to a 16k-mono WAV via gTTS. Cached per (text, lang) hash
    /// in the sidecar; returns the absolute path of the generated audio.
    pub async fn tts(&self, text: &str, lang: &str) -> Result<TtsResult> {
        let body = serde_json::json!({ "text": text, "lang": lang });
        let resp = self.post_json("/tts", &body).await?;
        let raw: TtsRawResponse = serde_json::from_value(resp)?;
        if raw.ok {
            Ok(TtsResult {
                audio_path: raw
                    .audio_path
                    .ok_or_else(|| Error::malformed("tts response missing 'audio_path'"))?,
                duration_ms: raw.duration_ms.unwrap_or(0),
            })
        } else {
            Err(Error::Api(raw.error.unwrap_or_else(|| {
                ErrorEnvelope::new(
                    crate::error::ErrorCode::Internal,
                    "tts returned ok=false but no error envelope",
                )
            })))
        }
    }

    /// Per-frame z-normalized pitch contours for both reference and user
    /// audio. Used by the PitchOverlay 'Show details' panel.
    pub async fn pitch_contour(
        &self,
        ref_audio_path: &str,
        user_audio_path: &str,
    ) -> Result<PitchContoursResponse> {
        let body = serde_json::json!({
            "ref_audio_path": ref_audio_path,
            "user_audio_path": user_audio_path,
        });
        let resp = self.post_json("/pitch", &body).await?;
        let raw: PitchRawResponse = serde_json::from_value(resp)?;
        if raw.ok {
            let ref_c = raw
                .r#ref
                .ok_or_else(|| Error::malformed("pitch response missing 'ref'"))?;
            let user_c = raw
                .user
                .ok_or_else(|| Error::malformed("pitch response missing 'user'"))?;
            Ok(PitchContoursResponse { r#ref: ref_c, user: user_c })
        } else {
            Err(Error::Api(raw.error.unwrap_or_else(|| {
                ErrorEnvelope::new(
                    crate::error::ErrorCode::Internal,
                    "pitch returned ok=false but no error envelope",
                )
            })))
        }
    }

    /// Call the sidecar's /score endpoint. Caller must have already sliced
    /// `ref_audio_path` to just the segment range — the sidecar compares the
    /// two clips wholesale (no internal slicing).
    pub async fn score(
        &self,
        ref_audio_path: &str,
        ref_text: &str,
        user_audio_path: &str,
    ) -> Result<ScoreData> {
        let body = serde_json::json!({
            "ref_audio_path": ref_audio_path,
            "ref_text": ref_text,
            "user_audio_path": user_audio_path,
        });
        let resp = self.post_json("/score", &body).await?;
        parse_score(resp)
    }

    async fn post_json(&self, path: &str, body: &serde_json::Value) -> Result<serde_json::Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.post(&url).json(body).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            Error::malformed(format!(
                "non-JSON response from {path} (status {status}): {e} | body: {}",
                text.chars().take(200).collect::<String>(),
            ))
        })?;
        if !status.is_success() {
            // Sidecar returned an error envelope per A4. Try to parse it.
            if let Some(err_field) = value.get("error") {
                if let Ok(env) = serde_json::from_value::<ErrorEnvelope>(err_field.clone()) {
                    return Err(Error::Api(env));
                }
            }
            return Err(Error::malformed(format!(
                "sidecar returned status {status} but no error envelope: {value}",
            )));
        }
        Ok(value)
    }

    /// Kill the sidecar process and reap it. Use this when shutting down
    /// cleanly. `kill_on_drop` handles the case where this isn't called.
    pub async fn kill(mut self) -> Result<()> {
        warn!(port = self.port, "killing sidecar");
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub duration_s: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsResult {
    pub audio_path: String,
    pub duration_ms: i64,
}

#[derive(Deserialize)]
struct TtsRawResponse {
    ok: bool,
    #[serde(default)]
    audio_path: Option<String>,
    #[serde(default)]
    duration_ms: Option<i64>,
    #[serde(default)]
    error: Option<ErrorEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchContour {
    pub f0_z: Vec<f64>,
    pub voiced: Vec<bool>,
    pub sr_hz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchContoursResponse {
    pub r#ref: PitchContour,
    pub user: PitchContour,
}

#[derive(Deserialize)]
struct PitchRawResponse {
    ok: bool,
    #[serde(default, rename = "ref")]
    r#ref: Option<PitchContour>,
    #[serde(default)]
    user: Option<PitchContour>,
    #[serde(default)]
    error: Option<ErrorEnvelope>,
}

#[derive(Deserialize)]
struct ProbeRawResponse {
    ok: bool,
    #[serde(default)]
    duration_s: Option<f64>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    error: Option<ErrorEnvelope>,
}

#[derive(Deserialize)]
struct IngestRawResponse {
    ok: bool,
    #[serde(default)]
    clip: Option<Clip>,
    #[serde(default)]
    error: Option<ErrorEnvelope>,
}

fn parse_ingest(value: serde_json::Value) -> Result<Clip> {
    let raw: IngestRawResponse = serde_json::from_value(value)?;
    if raw.ok {
        raw.clip.ok_or_else(|| Error::malformed("ingest response missing 'clip'"))
    } else {
        Err(Error::Api(raw.error.unwrap_or_else(|| {
            ErrorEnvelope::new(
                crate::error::ErrorCode::Internal,
                "ingest returned ok=false but no error envelope",
            )
        })))
    }
}

#[derive(Deserialize)]
struct ScoreRawResponse {
    ok: bool,
    #[serde(default)]
    score: Option<ScoreData>,
    #[serde(default)]
    error: Option<ErrorEnvelope>,
}

fn parse_score(value: serde_json::Value) -> Result<ScoreData> {
    let raw: ScoreRawResponse = serde_json::from_value(value)?;
    if raw.ok {
        raw.score.ok_or_else(|| Error::malformed("score response missing 'score'"))
    } else {
        Err(Error::Api(raw.error.unwrap_or_else(|| {
            ErrorEnvelope::new(
                crate::error::ErrorCode::Internal,
                "score returned ok=false but no error envelope",
            )
        })))
    }
}

async fn read_port_line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    timeout: Duration,
) -> Result<u16> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut line = String::new();
    loop {
        line.clear();
        let read_fut = reader.read_line(&mut line);
        let sleep_fut = tokio::time::sleep_until(deadline);

        tokio::select! {
            res = read_fut => {
                match res {
                    Ok(0) => {
                        return Err(Error::unreachable(
                            "sidecar stdout closed before printing PORT line",
                        ));
                    }
                    Ok(_) => {
                        let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
                        if let Some(port_str) = trimmed.strip_prefix("PORT=") {
                            let port: u16 = port_str.trim().parse().map_err(|e| {
                                Error::unreachable(format!("bad PORT line '{trimmed}': {e}"))
                            })?;
                            return Ok(port);
                        }
                        // Non-PORT line; keep reading.
                    }
                    Err(e) => return Err(e.into()),
                }
            }
            _ = sleep_fut => {
                return Err(Error::unreachable(format!(
                    "timeout waiting for PORT line ({}s)", timeout.as_secs(),
                )));
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarHandle {
    pub port: u16,
    pub pid: Option<u32>,
}

impl From<&Sidecar> for SidecarHandle {
    fn from(s: &Sidecar) -> Self {
        Self { port: s.port(), pid: s.pid() }
    }
}
