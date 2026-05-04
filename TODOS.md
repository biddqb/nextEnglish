# nextEnglish TODOs

Deferred work captured during /office-hours and /plan-eng-review on 2026-04-30.
Items here are NOT in v1 scope. They live here so context isn't lost.

---

## v1.1 — High-leverage adds after first week of daily use

### Test coverage expansion
**What:** Add `test_analyze.py` (pitch/RMS edge cases), Rust `db.rs` CRUD tests,
Playwright E2E for golden path.
**Why:** v1's T1A test scope intentionally skipped these. After daily use proves
the design, fill in the safety net before v2 expansion.
**Blocked by:** —
**Effort:** ~3 hours.

### Real-time pitch overlay during recording
**What:** Live pitch contour visualization while user speaks, not just post-hoc.
**Why:** Higher engagement; users see their pitch in real time and can self-correct.
**Cost:** Separate streaming protocol (WebSocket or Server-Sent Events from
sidecar to frontend), GPU-friendly extraction (parselmouth doesn't stream natively).
Probably means switching to `pyworld` or rolling own.
**Blocked by:** profiling P1's lazy-import strategy under sustained streaming load.
**Effort:** ~weekend.

### Audio cache eviction UI
**What:** Settings panel showing cache size, "Clear cached clips" button, optional
auto-evict oldest when over X GB.
**Why:** Audio + Whisper models will balloon to 5+ GB. Right now user has to find
the cache dir and `rm -rf` manually.
**Blocked by:** —
**Effort:** ~2 hours.

### Lazy-load module Session components via React.lazy
**What:** Once the modular registry has 4-5 modules and Voice/Speak pull in their own
ML/TTS/LLM client SDKs, switch each module's `Session` component to `React.lazy()` so
only the active module's code is downloaded.
**Why:** Today's bundle is ~500KB. Voice will pull TTS clients; Speak will pull LLM
SDKs. Could double or triple the bundle. Lazy-loading keeps initial render fast.
**Blocked by:** Voice module landing AND a bundle-size measurement showing meaningful
growth (>1MB). Speculative until then.
**Effort:** ~1 hour per module + Suspense boundaries in the shell.

### Module enable/disable Settings toggle
**What:** Per-module on/off toggles in SettingsPanel; `enabled: boolean` field on
SkillModule; only enabled modules appear in the switcher.
**Why:** Once 3+ modules ship, you'll want to focus a week on just shadowing or just
SRS without visual noise from unused modules.
**Blocked by:** 3+ modules existing. Don't build speculatively.
**Effort:** ~2 hours.

### Per-module Settings sub-panels
**What:** Replace the flat `useSettings` shape with per-module settings types via the
SkillModule interface. SettingsPanel renders a sub-panel per module instead of one
flat list.
**Why:** When 4+ modules each contribute 3-5 settings keys, the flat list becomes
unwieldy. Today (Issue 5A) the convention is `module.key` prefixes; this is the
upgrade path if/when that gets cramped.
**Blocked by:** Voice module shipping with multiple settings AND the flat-with-prefix
UI feeling crowded.
**Effort:** ~half a weekend.

---

## v2 — Pedagogical expansion (after v1 daily use is validated)

### SRS / FSRS for shadowed segments
**What:** Mark a segment as "favorite" → it enters an SRS queue. Daily review
session presents due segments for re-shadowing.
**Why:** Closes the loop from one-time practice to long-term retention. The
foundation pedagogy of the app's blueprint.
**Cost:** New schema (cards, reviews, due_dates), FSRS algorithm impl (or
ts-fsrs library), separate review UI mode.
**Blocked by:** v1 daily use needs to prove which segments are worth saving.
**Effort:** ~weekend.

### Cloze deletion flashcards from segments
**What:** Auto-generate fill-in-the-blank cards from saved segments, with the
chunk word(s) blanked out.
**Why:** Tests recall in context, not just recognition. Standard lexical-approach
exercise.
**Blocked by:** SRS infra above.
**Effort:** ~half a weekend after SRS exists.

### IT idioms / PVSS / business curriculum content
**What:** Curated content packs the user can browse and add as clips: 50-100
IT idioms ("touch base", "push the envelope"), PVSS scripting templates,
business collocations.
**Why:** Original blueprint goal. Domain-specific practice content.
**Cost:** This is a content-creation project, not engineering. Owner builds the
packs over time as he uses the app.
**Blocked by:** v1 daily use to know which content gaps matter most.

### Capture-to-Obsidian (second-brain inbox)
**What:** Hotkey to capture a phrase from clipboard or selected text → app
auto-generates a chunk card with audio (TTS or web-search) → flows into SRS →
markdown export to user's Obsidian vault.
**Why:** Original blueprint goal. Productivity-tool framing.
**Cost:** Cross-app capture (global hotkey via Tauri), TTS integration, Obsidian
markdown writer (file-watcher friendly).
**Blocked by:** SRS infra.
**Effort:** ~weekend.

### LLM conversation coach
**What:** Voice-or-text chat with an AI roleplaying scenarios (standup with
global team, YouTube hook script review, code review back-and-forth). Real-time
feedback on phrasing, fillers, IT collocations.
**Why:** Highest "whoa" factor in the original blueprint. Closes the gap between
practice and applied use.
**Cost:** Cloud LLM call (different infra), STT + TTS pipeline, a real
prompt-engineering pass to make the coach actually useful, cost monitoring.
**Blocked by:** —
**Effort:** ~2 weekends.

---

## v2.5 — Distribution

### Public release on GitHub Releases
**What:** Release pipeline (GitHub Actions) building Win/Mac/Linux artifacts
on tag push. Tauri's built-in updater pointed at the releases endpoint.
**Why:** Share with friends, eventually with the YouTube audience.
**Cost:** GitHub Actions workflow, code signing infra (see below).
**Blocked by:** owner deciding to share publicly (after a month of daily use).
**Effort:** ~half a weekend once decided.

### Mac code signing + notarization
**What:** Apple Developer membership ($99/yr), signing certs, notarization
in CI.
**Why:** Without it, Mac users get "unidentified developer" warnings.
**Blocked by:** decision to support Mac publicly.

### Auto-updater
**What:** Tauri's built-in updater pointing at a release endpoint.
**Why:** Users get bug fixes without re-downloading.
**Blocked by:** Public release infra.
**Effort:** ~2 hours once releases exist.

### Long-form clip ingest (>15 min)
**What:** Chunked transcription with progress events, OR background queue
with notification. Removes the v1 hard cap.
**Why:** User wants to shadow whole podcast episodes, not just clips.
**Cost:** Tauri tray notifications, a persistent jobs table, streaming progress
SSE/WebSocket from sidecar.
**Blocked by:** v1 hard cap proves itself either too restrictive or fine.
**Effort:** ~weekend.

---

## v3+ — Power features (only if v2 validates the daily-use model)

### Background-service sidecar
**What:** Python sidecar runs as a Windows Service / launchd agent / systemd
unit. App launches connect to already-running sidecar in <1s, no warmup.
**Why:** Best possible cold-start UX.
**Cost:** Cross-platform service install/uninstall is its own subproject.
Justified only if many people use the app daily.
**Blocked by:** real users who notice the warmup time.
**Effort:** ~weekend per platform.

### GPU detection / CUDA acceleration
**What:** Detect NVIDIA GPU at startup; if present, use CUDA build of
faster-whisper (4-10x faster transcription).
**Why:** YouTubers and developers often have GPUs.
**Cost:** Bundle CUDA wheels, larger installer, harder distribution.
**Blocked by:** public release with users who care.
**Effort:** ~half a weekend.

### Anki / SuperMemo export
**What:** Export saved segments as `.apkg` (Anki) or `.txt` (SuperMemo).
**Why:** Some users prefer their existing SRS tool.
**Blocked by:** SRS/cloze infra in v2.
**Effort:** ~2 hours.

### Multi-user, accounts, cloud sync
**What:** User accounts, sync clips/segments/sessions across devices.
**Why:** Only relevant if app goes public AND someone wants it on phone too.
**Blocked by:** there is no requirement for this. Probably never. Listed only
to mark it as explicitly NOT planned.
