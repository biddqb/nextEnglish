// Module-level state bridge for the Speak skill module.
//
// Mirrors src/modules/voice/state.ts. Speak is busy while the LLM is
// judging or the TTS prompt is being synthesized; the recording phase
// itself is owned by useVoiceRecording, which manages its own busy state
// via voice/state. Speak's own busy bridge fires for the parts that
// useVoiceRecording doesn't cover.

let busy = false;
let cancelImpl: (() => void) | null = null;

export function isBusy(): boolean {
  return busy;
}

export function setBusy(value: boolean): void {
  busy = value;
}

export function setCancelImpl(fn: (() => void) | null): void {
  cancelImpl = fn;
}

export function cancel(): void {
  cancelImpl?.();
}
