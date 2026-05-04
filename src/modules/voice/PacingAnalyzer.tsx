// Pacing analyzer sub-mode of the Voice module.
//
// Records a voiceover take, computes words-per-minute, silence ratio, and
// longest-pause duration from Whisper word-level timestamps + librosa
// silence detection (already in the audio pipeline).
//
// Skeleton shipped in voice-module-skeleton commit. Analysis logic lands
// in voice-pacing-analyzer commit.

export function PacingAnalyzer() {
  return (
    <div className="text-body-md text-muted py-app-section text-center">
      <p className="mb-xs">Pacing analyzer — under construction.</p>
      <p className="text-body-sm">
        Will report words-per-minute, silence ratio, and longest pause.
      </p>
    </div>
  );
}
