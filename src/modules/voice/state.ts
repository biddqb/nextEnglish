// Module-level state bridge for the Voice skill module.
//
// Mirrors src/modules/shadow/state.ts and src/modules/srs/state.ts. The
// shell's Esc-to-stop handler reads isBusy() to decide whether to claim
// Esc; calls cancel() when busy. The component reports its busy-ness
// here on every recording-state transition.

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
