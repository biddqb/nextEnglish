//! Standalone CLI smoke tester. Same Rust core as the Tauri shell, no webview.
//! Useful for verifying the integration without spinning up the frontend.
//!
//!     # Spawn sidecar, hit /health, kill cleanly
//!     cargo run --bin nextenglish-cli -- health
//!
//!     # Open / create a SQLite database and print schema_version
//!     cargo run --bin nextenglish-cli -- db-init nextenglish.db
//!
//!     # Full integration: spawn sidecar, ingest a URL, persist to DB
//!     cargo run --bin nextenglish-cli -- ingest --url "https://..." --db nextenglish.db

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use nextenglish_core::sidecar::{Sidecar, SidecarConfig};
use nextenglish_core::Database;
use tracing::{error, info};

#[derive(Parser)]
#[command(name = "nextenglish-cli", about = "Rust core smoke tester for nextEnglish v1")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,

    /// Path to the sidecar/ directory. Defaults to ../sidecar/ relative to the
    /// crate root, which works when running from src-tauri/ via cargo.
    #[arg(long, global = true)]
    sidecar_root: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Spawn the Python sidecar, verify /health, kill cleanly.
    Health,

    /// Open a SQLite database and print its schema_version.
    DbInit { path: PathBuf },

    /// Spawn sidecar, ingest a URL, persist clip + segments to SQLite, kill cleanly.
    Ingest {
        #[arg(long)]
        url: String,
        #[arg(long)]
        db: PathBuf,
        #[arg(long, default_value_t = 900)]
        max_duration_s: i32,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    nextenglish_core::log::init(None).expect("log init");
    let cli = Cli::parse();
    match run(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            error!("{e:?}");
            ExitCode::FAILURE
        }
    }
}

fn default_sidecar_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar"))
        .unwrap_or_else(|| PathBuf::from("../sidecar"))
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    let sidecar_root = cli.sidecar_root.unwrap_or_else(default_sidecar_root);
    let cfg = SidecarConfig::dev_at(sidecar_root);

    match cli.cmd {
        Cmd::Health => {
            let sidecar = Sidecar::spawn(cfg).await?;
            info!(port = sidecar.port(), pid = ?sidecar.pid(), "sidecar up");
            sidecar.health().await?;
            info!("/health OK");
            sidecar.kill().await?;
            info!("sidecar killed cleanly");
            Ok(())
        }
        Cmd::DbInit { path } => {
            let db = Database::open(&path)?;
            info!(?path, version = db.schema_version()?, "db ready");
            Ok(())
        }
        Cmd::Ingest { url, db, max_duration_s } => {
            let database = Database::open(&db)?;
            let sidecar = Sidecar::spawn(cfg).await?;
            info!(port = sidecar.port(), "sidecar up; calling /ingest");
            let clip = sidecar.ingest_url(&url, max_duration_s, None).await?;
            info!(
                title = %clip.title,
                duration_ms = clip.duration_ms,
                segments = clip.segments.len(),
                "ingest succeeded",
            );
            let transcript_json = serde_json::to_string(&clip.segments)?;
            let clip_id = database.insert_clip(
                &clip.title,
                &clip.source_uri,
                &clip.audio_path,
                clip.duration_ms,
                &transcript_json,
            )?;
            for seg in &clip.segments {
                database.insert_segment(clip_id, seg.start_ms, seg.end_ms, &seg.text)?;
            }
            info!(clip_id, segments = clip.segments.len(), "persisted to db");
            sidecar.kill().await?;
            Ok(())
        }
    }
}
