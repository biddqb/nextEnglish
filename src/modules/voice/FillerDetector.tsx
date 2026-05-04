// Filler-word detector sub-mode of the Voice module.
//
// Records a voiceover take, transcribes via existing Whisper ASR, counts
// occurrences of curated filler words ("um", "uh", "like", "you know", etc.)
// and surfaces a per-take total + per-word marks on the transcript view.
//
// Skeleton shipped in voice-module-skeleton commit. Detection logic lands
// in voice-filler-detector commit.

export function FillerDetector() {
  return (
    <div className="text-body-md text-muted py-app-section text-center">
      <p className="mb-xs">Filler detector — under construction.</p>
      <p className="text-body-sm">
        Will record your take, transcribe it, and count um/uh/like/you-know.
      </p>
    </div>
  );
}
