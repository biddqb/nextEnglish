// Vitest global setup. Runs before every test file via vite.config.ts test.setupFiles.
//
// Two responsibilities:
//   1. Wire up @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
//   2. Stub the Tauri + browser APIs that components touch at import or
//      render time, so jsdom doesn't blow up on missing globals.
//
// Per-test mocks (e.g. specific invoke responses, mocked queries) live in the
// individual test files via vi.mock — this file only handles the always-on
// scaffolding.

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Tauri's webview sets `__TAURI_INTERNALS__` on window when the app is
// running inside the native Tauri shell. `isInTauri()` in src/lib/api.ts
// checks for this and throws a friendly NOT_IN_TAURI error in browsers.
// For tests we want isInTauri() to return true so api.ts code paths run as
// they would in production; the actual `invoke` call gets mocked per-test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = globalThis.window ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__TAURI_INTERNALS__ = {};

// MediaRecorder + AudioContext + getUserMedia are required by src/lib/audio.ts
// at function-call time (not import time), so the mocks just need to exist
// on the globals when a test actually triggers a recording flow. Tests that
// don't record never hit these.
class MockMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(8)]) });
      this.onstop?.();
    });
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).MediaRecorder = MockMediaRecorder;

class MockAnalyser {
  fftSize = 1024;
  getByteTimeDomainData(buf: Uint8Array) {
    buf.fill(128);
  }
}
class MockAudioContext {
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return new MockAnalyser();
  }
  close() {
    return Promise.resolve();
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).AudioContext = MockAudioContext;

// Minimal getUserMedia + MediaStream stub. Recording tests that need real
// stream behavior should override this in their setup.
if (typeof navigator !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (navigator as any).mediaDevices = {
    getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: () => {} }],
    })),
  };
}

// Tauri SDK module mocks — modules import these eagerly, so the mocks have
// to exist before any test imports a component that touches them.
//
// We mock the modules statically here; tests that need specific behavior
// can override via vi.mock at the top of their file.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(async () => ""),
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(async () => {}),
  unregister: vi.fn(async () => {}),
  isRegistered: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFocused: async () => false }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (_cb: unknown) => Promise.resolve(() => {}),
  }),
}));

// React Testing Library cleanup between tests so DOM and component state
// don't leak across cases.
afterEach(() => {
  cleanup();
});
