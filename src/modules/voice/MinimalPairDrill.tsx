// Minimal-pair pronunciation drill sub-mode of the Voice module.
//
// Curated word pairs (ship/sheep, bit/beat, etc.). User pronounces each
// member of the pair; Whisper transcribes both. If Whisper hears the right
// word for both, your contrast is distinct enough; if it transcribes both
// as the same word or swaps them, that's the sound you're confusing.
//
// Skeleton shipped in voice-module-skeleton commit. Pair list + scoring
// land in voice-minimal-pair-drill commit.

export function MinimalPairDrill() {
  return (
    <div className="text-body-md text-muted py-app-section text-center">
      <p className="mb-xs">Minimal-pair drill — under construction.</p>
      <p className="text-body-sm">
        Will use Whisper as a listener: if it can't tell ship from sheep when
        you say them, that's the contrast to drill.
      </p>
    </div>
  );
}
