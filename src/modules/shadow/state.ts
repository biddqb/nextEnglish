// Module-level state bridge for the Shadow skill module.
//
// Issue 3A from /plan-eng-review: Shadow's session state moves out of the
// global zustand store into the component's local useState. Two pieces of
// state still need to be reachable from outside the React tree:
//
//   - isBusy() — the shell's Esc-to-stop handler reads this (via
//                shadowModule.isBusy() in src/lib/modules.tsx) to decide
//                whether to claim Esc.
//   - cancel() — the shell calls this when Esc fires while busy, to tell
//                ShadowSession to abort its current recording flow.
//
// There's only one ShadowSession instance at a time (the shell mounts one
// or the other module), so singleton flag + callback ref are fine. The
// component must clean up on unmount; otherwise stale state survives a
// navigation away from a recording.

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
