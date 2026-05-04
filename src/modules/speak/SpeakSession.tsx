// The Speak conversational practice studio.
//
// Flow (single-turn with optional go-deeper, per design):
//   1. Pick a scenario (curated dropdown or freeform topic).
//   2. App synthesizes the prompt via Piper TTS, plays it.
//   3. User records their reply.
//   4. Whisper transcribes; LLM judges (score / feedback / strengths /
//      improvements / optional follow-up question).
//   5. User can "Go deeper" to do one follow-up turn against the same
//      scenario, or pick a new scenario.
//
// Skeleton ships here; the real flow lands in step 9.6.

export function SpeakSession() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-xl py-app-section">
      <div className="text-caption-uppercase text-muted mb-xs">
        Speak practice
      </div>
      <h2 className="text-display-md text-ink mb-base">
        Conversational practice — under construction
      </h2>
      <p className="text-body-md text-body">
        Pick a scenario, hear the prompt, reply out loud, get a critique.
        Wiring lands in the conversation-flow step.
      </p>
    </div>
  );
}
