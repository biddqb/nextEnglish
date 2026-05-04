// Skill module registry — the seam that lets nextEnglish grow beyond shadowing.
//
// Two skill modules ship today, even if the codebase doesn't yet recognize
// them as such:
//
//   - Shadow:      ShadowSession + AttemptHistory + ScoreCard + PitchOverlay,
//                  backed by the v1 schema (clip, segment, session, attempt).
//                  Many recorded attempts per segment, immutable, scored on
//                  word/cadence/pitch.
//
//   - SRS-Review:  ReviewMode + ClozeEditor (currently embedded inside
//                  ShadowSession when `isSaved`), backed by schema 003+004
//                  (`card` table with FSRS state and `cloze_word_indices`
//                  presentation column). One card per saved segment; state
//                  mutates in place after each rating; cloze is a presentation
//                  mode of card, not a separate item.
//
// They share the clip library, the audio pipeline (yt-dlp + Whisper +
// parselmouth + DTW), the ScoreCard primitive, and the recording UI
// (RecordButton + WaveformMeter). Their attempt semantics are different
// (many-immutable vs one-mutable), so each module owns its own data tables.
//
// This file is the contract. Modules don't know about each other except
// through these registrations; the shell renders whichever module is active
// against the current clip.
//
// Build order (per ~/.gstack/projects/biddqb-nextEnglish/macos-main-design-*.md):
//
//   step 1: inventory pass (this comment block)
//   step 2: this file — interface + two stub registrations [you are here]
//   step 3: Vitest + 5 characterization tests against current code
//   step 4: extract useRecordAndScore hook (currently duplicated)
//   step 5: refactor ShadowSession into src/modules/shadow/, wire isBusy()
//   step 6: refactor ReviewMode + ClozeEditor into src/modules/srs/
//   step 7: shell reads the registry instead of hard-coding ShadowSession
//
//
// ┌─────────────────────────────────────────────────────────────────┐
// │ src/lib/modules.tsx                                             │
// │                                                                 │
// │   interface SkillModule { id, ui:{Session,History?,Analysis?},  │
// │                            isBusy() }                           │
// │                                                                 │
// │   registry = [ shadowModule, srsModule ]                        │
// └──────────────┬──────────────────────────────┬───────────────────┘
//                │                              │
//                ▼                              ▼
//    ┌───────────────────────┐      ┌──────────────────────────┐
//    │ src/modules/shadow/   │      │ src/modules/srs/         │
//    │  Session: ShadowSess  │      │  Session: ReviewMode     │
//    │  History: AttemptHist │      │  (no History — in-place) │
//    │  isBusy() ← local st. │      │  isBusy() ← local Phase  │
//    │  imports <ClozeEditor>│◄─────┤  exports ClozeEditor     │
//    │   from srs (Issue 1A) │      │                          │
//    └─────────┬─────────────┘      └──────────┬───────────────┘
//              │                               │
//              └───────────┬───────────────────┘
//                          ▼
//               ┌──────────────────────────┐
//               │ src/lib/recording.ts     │ ← step 4 (Issue 2A)
//               │   useRecordAndScore()    │
//               └──────────────────────────┘
//
// Until step 5/6 land, the registrations below wrap the existing components
// in adapter functions and stub isBusy() to false. The interface is what's
// load-bearing this week, not the wiring.

import type { ComponentType } from "react";
import { ShadowSession } from "../modules/shadow/ShadowSession";
import {
  cancel as shadowCancel,
  isBusy as shadowIsBusy,
} from "../modules/shadow/state";
import { ReviewMode } from "../modules/srs/ReviewMode";
import {
  cancel as srsCancel,
  isBusy as srsIsBusy,
} from "../modules/srs/state";
import { VoiceSession } from "../modules/voice/VoiceSession";
import {
  cancel as voiceCancel,
  isBusy as voiceIsBusy,
} from "../modules/voice/state";
import { SpeakSession } from "../modules/speak/SpeakSession";
import {
  cancel as speakCancel,
  isBusy as speakIsBusy,
} from "../modules/speak/state";

export type ModuleId = "shadow" | "srs" | "voice" | "speak";

// Each module exposes one or more UI surfaces. The shape of that surface
// differs by module:
//
//   - Shadow's primary view (Session) is clip + segment scoped.
//   - SRS's primary view (Session) ignores clipId/segmentIndex and walks its
//     own due-card cursor internally.
//   - Voice (future) will likely expose Analysis (clip-level) instead of
//     Session, or in addition to it.
//
// Optional fields let each module take only what it needs without faking.
// Note that the History/Analysis surfaces are declared here for future use
// but neither shipped module exposes them yet — Shadow currently embeds
// AttemptHistory inside its Session view; promoting it to a top-level
// surface is a step 5 wiring task, not part of step 2.
export interface SkillModuleUi {
  Session: ComponentType<{ clipId?: number; segmentIndex?: number }>;
  History?: ComponentType<{ clipId: number; segmentIndex?: number }>;
  Analysis?: ComponentType<{ clipId: number }>;
}

export interface SkillModule {
  id: ModuleId;
  displayName: string;
  sidebarOrder: number;
  ui: SkillModuleUi;

  // Returns true while the module is mid-recording or mid-analyzing. The
  // shell's Esc-to-stop keyboard handler reads this to decide whether to
  // claim Esc; without it, we'd have to leak module-internal state into the
  // global zustand store (the pattern Shadow used pre-Issue-3A).
  isBusy: () => boolean;

  // Tells the module to abort its current busy work — typically called by
  // the shell on Esc when isBusy() is true. Optional because some modules
  // never enter a busy state (e.g., a future read-only Voice analysis view).
  cancel?: () => void;
}

// Adapter for Shadow: ShadowSession requires both clipId and segmentIndex.
// The shell only renders this when a segment is selected (App.tsx already
// gates this), so the null-guard here is defensive — return null rather than
// crash if the shell ever calls us without props. Step 7 moves the gating
// into the shell's module-routing code.
function ShadowSessionAdapter({
  clipId,
  segmentIndex,
}: {
  clipId?: number;
  segmentIndex?: number;
}) {
  if (clipId == null || segmentIndex == null) return null;
  return <ShadowSession clipId={clipId} segmentIndex={segmentIndex} />;
}

// Adapter for SRS: ReviewMode takes no props and walks its own due-card
// queue internally. The shell-passed clipId/segmentIndex are ignored on
// purpose — SRS is module-driven, not clip-driven.
function ReviewModeAdapter(_props: { clipId?: number; segmentIndex?: number }) {
  return <ReviewMode />;
}

// Adapter for Voice: clip-free. Voice records standalone takes; clipId
// and segmentIndex are ignored.
function VoiceSessionAdapter(_props: {
  clipId?: number;
  segmentIndex?: number;
}) {
  return <VoiceSession />;
}

// Adapter for Speak: clip-free. Speak owns its own scenario state and
// drives a TTS prompt → user reply → LLM critique loop; clipId and
// segmentIndex are ignored, same as Voice.
function SpeakSessionAdapter(_props: {
  clipId?: number;
  segmentIndex?: number;
}) {
  return <SpeakSession />;
}

const shadowModule: SkillModule = {
  id: "shadow",
  displayName: "Shadow",
  sidebarOrder: 1,
  ui: {
    Session: ShadowSessionAdapter,
  },
  isBusy: shadowIsBusy,
  cancel: shadowCancel,
};

const srsModule: SkillModule = {
  id: "srs",
  displayName: "Review",
  sidebarOrder: 2,
  ui: {
    Session: ReviewModeAdapter,
  },
  isBusy: srsIsBusy,
  cancel: srsCancel,
};

const voiceModule: SkillModule = {
  id: "voice",
  displayName: "Voice",
  sidebarOrder: 3,
  ui: {
    Session: VoiceSessionAdapter,
  },
  isBusy: voiceIsBusy,
  cancel: voiceCancel,
};

const speakModule: SkillModule = {
  id: "speak",
  displayName: "Speak",
  sidebarOrder: 4,
  ui: {
    Session: SpeakSessionAdapter,
  },
  isBusy: speakIsBusy,
  cancel: speakCancel,
};

export const modules: SkillModule[] = [
  shadowModule,
  srsModule,
  voiceModule,
  speakModule,
];

export function getModule(id: ModuleId): SkillModule | undefined {
  return modules.find((m) => m.id === id);
}
