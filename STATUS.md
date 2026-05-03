# nextEnglish — Status & Handoff

*As of 2026-04-30 (post-Bucket-1 shipping pass). Update this doc when major
decisions land or major chunks ship.*

---

## What this is

A desktop English-shadowing app for an IT engineer who works with global clients
and runs an IT/AI YouTube channel. The wedge is **shadowing**: paste a YouTube
URL, the app transcribes it, lets you shadow individual sentences, and scores
your attempt on word accuracy + cadence + pitch correlation.

Differentiator vs. ELSA / Speechling / BoldVoice: paste *any* clip, not curated
content. The user wants to sound like specific YouTubers, not generic
"American English."

Aesthetic: editorial-magazine voice (ElevenLabs-ish). Off-white canvas, warm
near-black ink, Waldenburg Light 300 display (EB Garamond as substitute), Inter
body, atmospheric pastel gradient orbs as the only "color" moments. No saturated
CTA color, no dashboard-card mosaic, no SaaS slop.

---

## Current state: **v1 is functionally complete**

End-to-end flow works:

1. Paste a YouTube URL → ingest (yt-dlp + Whisper + segment alignment) → clip
   appears in sidebar
2. Click clip → segment list shows all auto-segmented sentences with timestamps
3. Click a segment → ShadowSession opens with reference audio loaded
4. Press Record (or Space) → mic permission prompt → reference auto-plays →
   live level meter
5. Press Stop (or Esc) → audio normalized to WAV → sidecar scores it →
   ScoreCard shows the editorial instrument-panel layout (overall + word/
   cadence/pitch)
6. "Try again" replays + re-records on same segment

What's calibrated: the score formula weights are at `0.40 word / 0.35 cadence /
0.25 pitch` (v1, from initial v0 = 0.50/0.40/0.10 which the user found too
generous on flat-pitch attempts).

What's verified: 8 Rust tests pass (6 db unit + 2 sidecar integration with
no-zombie-process guarantee), 29/30 Python tests pass (1 skipped — the golden
fixture ranking test, awaiting real owner-recorded fixtures), full Vite build
clean, full cargo build clean, real ingest of a 7-min TEDx clip works.

---

## How to run

```powershell
cd F:\Project\nextEnglish

# Run the app (development mode — opens a desktop window):
npm run tauri dev

# Standalone CLI smoke tester (no window, no React):
cd src-tauri
cargo run --bin nextenglish-cli -- health
cargo run --bin nextenglish-cli -- ingest --url "https://..." --db ../_work/test.db

# Python sidecar CLI (used by the standalone CLI above; useful for solo testing):
cd ..\sidecar
uv run python -m sidecar.cli ingest "https://..."
uv run python -m sidecar.cli extract _work/cli/audio.wav 1
uv run python -m sidecar.cli score _work/cli/audio.wav <attempt> --segment-index 1

# Tests:
cd src-tauri && cargo test           # Rust (5 tests)
cd sidecar && uv run pytest          # Python (~30 tests)
cd ..\..  && npx tsc --noEmit        # TypeScript type-check only
cd F:\Project\nextEnglish && npm run build  # Full frontend bundle
```

First-time `npm run tauri dev` notes:
- `cargo build` of the Tauri shell takes ~5 min (downloads + compiles tauri,
  webview2, wry crates). Subsequent runs are cached.
- First /ingest call downloads `small.en` Whisper model (~500MB) and `wav2vec2`
  (~360MB) into `~/.cache/huggingface/hub/`. One-time.
- First /score call lazy-imports torch / parselmouth (~5-8s warmup). Subsequent
  calls are instant.

---

## Architecture (three tiers)

```
┌──────────────────────────────────────────────────────────────────┐
│  Tauri 2 webview (React + TS + Tailwind)                         │
│  src/                                                            │
│  ├── App.tsx, main.tsx                                           │
│  ├── components/   ClipPicker, SegmentList, ShadowSession, etc.  │
│  └── lib/          api, store (zustand), queries (react-query),  │
│                    audio, keyboard, types                        │
└───────────────────────┬──────────────────────────────────────────┘
                        │ Tauri IPC (invoke commands)
┌───────────────────────▼──────────────────────────────────────────┐
│  Rust core (src-tauri/)                                          │
│  • Tauri shell + 7 commands (commands.rs)                        │
│  • SQLite via rusqlite, with schema_version (db.rs)              │
│  • Python sidecar lifecycle: spawn, kill_on_drop (sidecar.rs)    │
│  • Error envelope + tracing logs                                 │
│  • ffmpeg CLI for segment slicing                                │
│  • base64 decode for audio bytes from frontend                   │
└───────────────────────┬──────────────────────────────────────────┘
                        │ HTTP on 127.0.0.1:<random> (kill_on_drop)
┌───────────────────────▼──────────────────────────────────────────┐
│  Python sidecar (sidecar/)                                       │
│  • FastAPI + uvicorn (server.py)                                 │
│  • CLI smoke tester (cli.py) — also invokable standalone         │
│  • ingest:   yt-dlp + ffmpeg normalize to 16k mono               │
│  • transcribe: faster-whisper word-level timestamps              │
│  • analyze:  parselmouth pitch, librosa RMS, silero-vad trim     │
│  • score:    DTW + word match + z-norm pitch correlation         │
│  • Lazy-imports torch/whisper/parselmouth (eng P1A)              │
└──────────────────────────────────────────────────────────────────┘
```

Persistent storage:
- SQLite database: `_work/nextenglish.db` (clips, segments, sessions, attempts)
- Audio files: `sidecar/_work/clips/<sha12>/audio.wav` (per-clip dir, hash-keyed
  by URL, idempotent re-ingest)
- Sliced segments: `sidecar/_work/clips/<sha12>/segments/<i>.wav`
- User attempts: `sidecar/_work/clips/<sha12>/attempts/<i>_<ts>.<ext>`
  (raw webm/m4a) + `<i>_<ts>.wav` (normalized for parselmouth)

NOTE: Pre-Phase-3b ingests went to `_work/current/` (overwriting). After the
hash-key fix, that's a legacy path. The Rust `commands.rs::list_clips` and
`get_clip` resolve relative DB paths to absolute at read time so old rows still
work.

---

## Design decisions worth knowing (the stuff that's not obvious from code)

### Why this stack
The user invoked `/office-hours` and chose architecture **B** (Tauri + Rust +
Python sidecar) over A (Electron) and C (pure Python + PyWebView), even after
being warned it'd take longer. They've shipped Rust before. Their feedback
memory pattern (`feedback_craft_over_speed.md`) says this is consistent —
they pick craft over speed. Don't relitigate this.

### Why these score weights
**v1: `W_WORD=0.40, W_CADENCE=0.35, W_PITCH=0.25`** (in
`sidecar/sidecar/pipeline/score.py`, with calibration history comment).

The original `0.50/0.40/0.10` felt generous: a monotone but word-accurate
attempt scored 85, which under-rewarded the prosody match that IS the point of
shadowing. The user said "85 felt generous" → re-weighted, same attempt now
scores 71 → they confirmed that felt honest. Don't change without similar
real-data calibration.

### Why "editorial / instrument-panel" score reveal (design 3A)
The user picked it during `/plan-design-review`. Big display-mega Waldenburg
Light digit, three caption-uppercase sub-metrics, mispronounced words rendered
as a hairline underline (no color, no red). Treats the user as an adult who
can self-evaluate. Tone: "here's what we measured, you decide." Don't add
encouragement copy or gamification — that would break the brand voice and
contradict the user's stated preference for honest feedback.

### Eng review fixes (A1-A8) baked into the code
All of these are landed; recurring failure modes if they regress:

- **A1 (mic format)**: MediaRecorder records at native rate (48kHz on
  Windows). Python sidecar resamples to 16k mono via librosa. Frontend doesn't
  know about resampling.
- **A2 (sidecar lifecycle)**: Direct python invocation (`venv/Scripts/python.exe`,
  not `uv run`) so kill cascades. Plus `tokio::Command::kill_on_drop(true)`.
  Tauri's externalBin in production gives Windows JobObject + Unix pgroup
  cleanup.
- **A3 (first-run)**: Defaults to `small.en` (~500MB), not `medium.en`. Faster
  first ingest. Toggle to upgrade is v1.1 settings panel work.
- **A4 (error envelope)**: All API responses use `{ok: bool, ...}` discriminated
  union. Errors carry `{code, message, retryable}`. Same shape across Python /
  Rust / TS.
- **A5A (15-min cap)**: Hard cap enforced before download. Trim dialog UI is
  v1.1 work.
- **A6 (schema_version)**: Table from day 1, even though there's only one
  version. Avoids retrofit when v2 lands SRS tables.
- **A7 (DTW silence trim)**: silero-vad trims leading/trailing silence on both
  clips before DTW. Without it, recording-button latency wrecks the cadence
  score. `analyze.trim_silence` returns `None` if no speech detected;
  `cadence_score` then returns `0.0` explicitly.
- **A8 (pitch z-norm)**: Z-normalize each f0 contour on voiced frames before
  Pearson correlation. Different speakers' pitch ranges otherwise produce
  meaningless correlation values.

### P1A — sidecar lazy imports
Sidecar starts with stdlib + fastapi + loguru + typer (all light). torch /
faster-whisper / whisperx / parselmouth / silero-vad are imported INSIDE the
handler functions on first call (~5-8s cold). This is why app launch is fast
but first /ingest of a session has a ~6s "preparing audio engine" hiccup.
Don't refactor to eager imports — it'll regress launch time.

---

## Bugs caught and fixed during the build (so future you doesn't redo them)

| # | Bug | Fix location |
|---|-----|--------------|
| 1 | `cadence_score` returned ~0.014 for silent attempts instead of 0.0 — `trim_silence` was returning the full silent audio when VAD found no speech | `analyze.trim_silence` now returns `Optional[ndarray]`, `cadence_score` returns 0 explicitly |
| 2 | Test expected pure synthetic tones to give zero pitch variance after parselmouth — wrong, parselmouth has natural jitter on tones | Test fixtures use a real LibriSpeech sample via `librosa.example("libri1")` for cadence/score tests |
| 3 | Parselmouth fails on M4A (Voice Recorder format) — "Not an audio file." | `pipeline/ingest.py::ensure_wav` normalizes to .wav as a sibling file before any parselmouth call. Used by both CLI's score command and HTTP /score |
| 4 | `cargo run` ambiguous with two binaries | `default-run = "nextenglish"` in Cargo.toml |
| 5 | `tauri-build` fails on Windows without `icons/icon.ico` | Generated 256x256 ICO via ffmpeg |
| 6 | Reqwest 120s default timeout aborted long ingests mid-flight | Bumped client timeout to 600s + 5s connect_timeout |
| 7 | `uv run python` creates parent + grandchild process tree; `kill_on_drop` only reaped the uv parent, python kept running and held the port | `SidecarConfig::dev_at` now points directly at `<root>/.venv/Scripts/python.exe` |
| 8 | `tokio::net::TcpStream::connect` hangs ~21s on stale Windows port (SYN retry) | Integration tests use `tokio::time::timeout(1s, connect)` for the port-bound check |
| 9 | Python sidecar wrote every ingest to `_work/current/`, overwriting the previous clip | `server.py` now hash-keys: `_work/clips/<sha256[:12]>/` |
| 10 | Pre-Phase-3b clips in DB had relative `audio_path` that the Tauri asset protocol couldn't resolve | `commands.rs::list_clips` and `get_clip` resolve relative paths against `sidecar_root` at read time |
| 11 | `Cannot read properties of undefined (reading 'invoke')` when frontend opened in regular browser | `App.tsx` checks `__TAURI_INTERNALS__` and shows an explanatory banner instead of a confusing error |
| 12 | Score endpoint failed on user's webm attempt (parselmouth can't read webm) | `server.py /score` calls `ensure_wav(user_audio)` before scoring |
| 13 | Tightening asset-protocol scope from `**` to `**/_work/clips/**` broke playback for legacy clips that point at the pre-Phase-3b `_work/current/audio.wav` path | Widened to `**/_work/**` so all current paths plus the legacy `_work/current/` are covered; still meaningfully tighter than the original `**` |

## Open bugs (deferred — pick up next session)

### Capture-to-Obsidian: `readText()` throws on empty/non-text clipboard
**Symptom:** Toast shows `Capture failed: The clipboard contents were not available in the requested format or the clipboard is empty.`

**Reproducible flow:** Switch to browser → select text (without first pressing Ctrl+C) → press the capture hotkey (Ctrl+Alt+C). The auto-Ctrl+C path was supposed to handle this, but the *first* clipboard read throws before we get to the simulated copy.

**What's been tried:** Wrapped both `readText()` calls in a `safeReadClipboard()` helper that returns `""` on rejection (App.tsx, latest commit). **Untested by the user** as of session-end on 2026-04-30.

**What to verify next:**
1. Hard-restart `npm run tauri dev` (Tauri does not restart the Python sidecar on JS changes — see `SIDECAR_BUILD_TAG` banner)
2. Reproduce the flow above and check whether the safeReadClipboard fix resolves it
3. If the toast now shows "Nothing to capture. Select some text first..." with an EMPTY selection, the read path is fixed and the issue is elsewhere
4. If the original "clipboard contents not available" error reappears, the wrapping isn't catching it — check whether the Tauri plugin throws synchronously vs returns a rejected promise (different failure modes need different guards)

**Adjacent unverified bits to test once that's working:**
- Piper voice download path (first capture should download ~63MB to `~/.cache/nextenglish/piper/`; subsequent captures should be sub-second + fully offline)
- `SIDECAR_BUILD_TAG=tts-piper-v2` banner appearing in dev terminal at sidecar startup
- A successful capture round-trip with normal selected text in browser/Slack
- Captured cards appearing in Sidebar with the ✎ avatar
- Markdown export reading the captured cards

---

## What's been built (file map)

### Frontend (React + Tailwind)
```
src/
├── main.tsx                  React + react-query provider
├── App.tsx                   Top-level state machine + keyboard hooks
├── styles.css                Tailwind directives + UI_DESIGN typography classes
├── lib/
│   ├── types.ts              Type mirrors of Rust + Python models
│   ├── api.ts                Typed wrappers around invoke()
│   ├── store.ts              zustand: selected clip/segment, sidebar, session
│   ├── queries.ts            react-query hooks
│   ├── audio.ts              MediaRecorder helper + level meter via AnalyserNode
│   └── keyboard.ts           Global keyboard shortcuts hook
└── components/
    ├── AppShell.tsx          Two-pane layout, auto-collapse <1100px
    ├── TopBar.tsx            Wordmark + breadcrumb
    ├── Sidebar.tsx           Clip library, skeleton loading, "+ Add clip" outline pill
    ├── ClipRow.tsx           voice-row adaptation: 32px circular initials + title + sub-line
    ├── ClipPicker.tsx        URL paste form
    ├── EmptyStateHero.tsx    First-launch view with drifting mint orb
    ├── SegmentList.tsx       Click-to-select segment list
    ├── ShadowSession.tsx     Full play/record/score state machine
    ├── ScoreCard.tsx         Editorial 3A: tweened number, mispronounced words underlined
    ├── PitchOverlay.tsx      Power-user textual breakdown (real SVG contour is v1.1)
    ├── RecordButton.tsx      64→80px ink pill with peach orb pulse
    ├── LevelMeter.tsx        5-tick hairline meter
    └── Scrubber.tsx          Range-input scrubber styled to match
```

### Tailwind config + tokens
```
tailwind.config.ts            All UI_DESIGN colors, spacing, radius, fonts
postcss.config.cjs            Standard tailwind + autoprefixer
src/styles.css                Typography classes (.text-display-mega, etc.)
                              + animations (score-rise, orb-drift, listen-pulse)
                              + component primitives (.button-primary, .text-input)
```

### Rust core (Tauri 2)
```
src-tauri/
├── Cargo.toml                Tauri 2 + tokio + rusqlite-bundled + reqwest + base64
├── build.rs                  tauri-build
├── tauri.conf.json           Window 1100x700, identifier digital.overdose.nextenglish, asset-protocol
├── capabilities/default.json Tauri 2 default capabilities
├── icons/icon.png|icon.ico   Placeholder 512px black square (replace before release)
├── migrations/001_initial.sql Full v1 schema, idempotent
├── src/
│   ├── main.rs               Tauri entry
│   ├── lib.rs                run() — spawns sidecar, opens DB, runs builder
│   ├── error.rs              Error / ErrorCode / ErrorEnvelope (mirrors Python A4)
│   ├── models.rs             Clip, Segment, ScoreData, etc. (mirrors Python C1)
│   ├── db.rs                 rusqlite + 3 unit tests + record_attempt
│   ├── sidecar.rs            Spawn, /health, /ingest, /score
│   ├── commands.rs           7 Tauri commands + ffmpeg slice helper
│   ├── log.rs                tracing-subscriber to app_data_dir/logs/
│   └── bin/cli.rs            Standalone CLI smoke tester
└── tests/integration_sidecar.rs  Sidecar lifecycle tests (no zombies)
```

### Python sidecar
```
sidecar/
├── pyproject.toml            Python ≥3.11, all heavy ML deps
├── sidecar/
│   ├── server.py             FastAPI, lazy imports, hash-keyed work dir
│   ├── cli.py                ingest / extract / score / serve subcommands
│   ├── log.py                loguru
│   └── pipeline/
│       ├── models.py         Pydantic types
│       ├── ingest.py         yt-dlp, ffmpeg normalize, ensure_wav helper
│       ├── transcribe.py     faster-whisper with cached model
│       ├── analyze.py        parselmouth, librosa, silero-vad
│       └── score.py          DTW + z-norm pitch + word accuracy + weights
└── tests/
    ├── conftest.py           Synthetic + LibriSpeech fixtures (skips if offline)
    ├── test_score.py         Word, cadence, pitch, formula, golden-set placeholder
    └── test_ingest.py        URL validation, file ingest, A5A cap regression
```

### Reference docs in repo
- `DESIGN.md` — original product/eng spec + eng review decisions section + design review decisions section. **The source of truth for what v1 is.**
- `UI_DESIGN.md` — design system (colors, typography, components) + App Shell Extensions (sidebar, record button, score card, etc.). **The source of truth for how v1 looks.**
- `TODOS.md` — every deferred item with what/why/cost, organized by v1.1 / v2 / v2.5 / v3+.
- `docs/test-plan-v1.md` — test plan from eng review (T1A scope).

### Persistent memory
At `C:/Users/OS/.claude/projects/f--Project-nextEnglish/memory/`:
- `MEMORY.md` — index
- `user_profile.md` — 28yo IT engineer at overdose.digital, IT/AI YouTube channel, ships Rust, Python-fluent
- `project_nextenglish.md` — what we're building, premises, architecture, deferred items
- `feedback_craft_over_speed.md` — picks higher-craft option even after timeline warnings; don't relitigate

---

## What's NOT done (3 buckets)

### Bucket 1: Daily-use polish — ✓ shipped

All eight of the original Bucket 1 items landed on 2026-04-30, plus two
related additions:

- Score history per segment — persistent under ScoreCard. Sparkline (fixed
  0-100 scale, hairline ink) + recent-attempts list with paired
  "▷ You / ▷ Ref" A/B playback per row. `list_attempts` Tauri command +
  `useAttempts` hook. Attempts auto-pause when ShadowSession claims the
  audio output.
- Delete clip from sidebar — hover-revealed × on each row, inline
  "Delete this clip? · Cancel · Delete" confirm without a modal. ON DELETE
  CASCADE handles segments/sessions/attempts; on-disk hash-keyed clip dir
  removed best-effort.
- Best-attempt highlight in sparkline + "Best" tag in row list.
- Auto re-record loop — 2.0s editorial pause after scoring, configurable
  via Settings (set 0 to disable). Visible countdown under Try again with
  a Hold control. Cancels automatically on AttemptHistory playback.
- Live waveform during recording — replaces the old 5-tick LevelMeter.
  Self-contained `WaveformMeter` reads recorder.meter() via RAF at 30fps,
  4-second rolling buffer, mirrored ink bars on hairline center axis.
- Keyboard shortcuts overlay — opens via `?`, ⌘/Ctrl+, opens Settings.
  Layered Esc priority: close overlay → close settings → stop recording.
- File drag-drop ingest (any audio/video file dropped on the window) —
  Tauri 2 webview `onDragDropEvent`, with a `DropOverlay` that shows
  "Drop to ingest" / "Ingesting clip…" states and an error toast.
- Trim dialog for >15-min URLs — new `/probe` endpoint returns duration
  without downloading; user picks a window up to the configured cap; trim
  is sent through yt-dlp's `download_ranges` so we don't fetch the whole
  clip just to slice it. Cache key includes the trim window.
- Real pitch contour SVG in PitchOverlay — new `/pitch` endpoint returns
  z-normalized f0 + voiced-mask for both reference and user audio. Two
  contours overlaid on a hairline center axis (reference = ink, user =
  peach). Unvoiced frames break the path. "Show details" toggle so the
  parselmouth call is lazy.
- Per-segment best score in SegmentList — right-aligned tabular number
  next to each segment row, "—" if not yet attempted. New
  `list_segment_best_scores` Tauri command + `useSegmentBestScores` hook.

### Bucket 2: Pre-public-release polish

| Item | Cost | Status |
|---|---|---|
| Settings panel (model size, default cap, auto-loop pause, cache eviction) | half day | ✓ shipped — schema v2 `settings` table, Cmd/Ctrl+, opens, gear in TopBar |
| Asset-protocol scope tighten | 30 min | ✓ shipped — was `**`, now `$RESOURCE/**`, `$APPDATA/**`, `**/_work/**` |
| Cache eviction UI | 2 hours | ✓ shipped — inside Settings panel, two-step confirm, recreates empty dir |
| App icon redesign (currently placeholder black square) | depends | needs design taste call |
| Light/dark mode toggle | half day, requires dark-canvas variants of gradient orbs | needs dark-canvas brand spec |
| PyInstaller bundle of sidecar | weekend, real cross-platform pain | needs Mac + Linux validation |
| Auto-updater + GitHub Releases CI | weekend | needs git remote (no GitHub repo wired up yet) |
| Mac code signing + notarization | $99/yr Apple Developer + 1 day | needs Apple Developer account |
| Mic device picker in Settings | 1-2 hours | deferred — unclear it's a real pain point yet |

### Bucket 3: v2+ (NOT in v1 scope per DESIGN.md)

Listed in TODOS.md, briefly:
- SRS / FSRS for shadowed segments (foundation pedagogy goal)
- Cloze deletion flashcards
- IT idioms / PVSS / business curriculum content
- Capture-to-Obsidian / second-brain inbox
- LLM conversation coach
- Long-form clip ingest with chunked transcription / background queue

---

## What I'd actually do next

The functional v1 surface is complete after the 2026-04-30 shipping pass.
What's left to release publicly is all in Bucket 2: app icon, dark mode,
PyInstaller bundling, auto-updater, Mac code signing — and none of those
land without external inputs (design taste, repo state, Apple Dev
account, cross-platform machines).

The DESIGN.md success criterion #1:

> "Owner uses the app for shadowing at least 4 days in a single week without
> asking the developer (himself) to fix anything."

That's the right next milestone. Use the app for a week, then come back
with: which Bucket-2 items move to "blocking", which Tier-A polish items
need a second pass, and what surprises real practice surfaces.

---

## Picking up in a new session

1. Open this file. Skim "Current state", "Bugs caught and fixed", and the file map.
2. Open `DESIGN.md` and `UI_DESIGN.md` if you forget the design language.
3. The persistent memory at `~/.claude/projects/.../memory/` will auto-load and remind future-me of who you are + the craft-over-speed preference.
4. Run `npm run tauri dev` to get to a working state.
5. Decide: are we polishing v1 (pick from Bucket 1), starting v2 (pick from TODOS.md), or fixing a real bug from your daily use?

When in doubt, the answer is "use the app first, build second."
