import type { AppSettings, SettingPair } from "./types";

// Default user settings — used when nothing has been persisted yet, and as
// the fallback when a saved value can't be parsed.
export const defaultAppSettings: AppSettings = {
  whisperModel: "small.en",
  maxDurationS: 900,
  autoLoopMs: 2000,
  obsidianVaultPath: "",
  captureHotkey: "CommandOrControl+Alt+C",
};

// SQLite settings keys. Centralized so a typo in one place doesn't silently
// shadow a real setting.
export const SETTING_KEYS = {
  whisperModel: "whisper_model",
  maxDurationS: "max_duration_s",
  autoLoopMs: "auto_loop_ms",
  obsidianVaultPath: "obsidian_vault_path",
  captureHotkey: "capture_hotkey",
} as const;

export const WHISPER_MODELS = [
  { id: "tiny.en", label: "Tiny — fastest, less accurate (~75 MB)" },
  { id: "base.en", label: "Base — balanced for short clips (~140 MB)" },
  { id: "small.en", label: "Small — recommended (~480 MB)" },
  { id: "medium.en", label: "Medium — slower, very accurate (~1.5 GB)" },
  { id: "large-v2", label: "Large v2 — slowest, multilingual (~3 GB)" },
] as const;

export function settingsFromPairs(pairs: SettingPair[]): AppSettings {
  const map = new Map(pairs.map((p) => [p.key, p.value]));
  return {
    whisperModel:
      map.get(SETTING_KEYS.whisperModel) ?? defaultAppSettings.whisperModel,
    maxDurationS:
      parseIntOr(map.get(SETTING_KEYS.maxDurationS), defaultAppSettings.maxDurationS),
    autoLoopMs:
      parseIntOr(map.get(SETTING_KEYS.autoLoopMs), defaultAppSettings.autoLoopMs),
    obsidianVaultPath:
      map.get(SETTING_KEYS.obsidianVaultPath) ?? defaultAppSettings.obsidianVaultPath,
    captureHotkey:
      map.get(SETTING_KEYS.captureHotkey) ?? defaultAppSettings.captureHotkey,
  };
}

// Tauri's accelerator format: + separated, modifiers + a single key.
// We accept what Tauri accepts; this just rejects obviously-empty strings.
export function isValidHotkey(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // Must contain at least one + (modifier+key) and no whitespace.
  if (!t.includes("+")) return false;
  if (/\s/.test(t)) return false;
  return true;
}

function parseIntOr(v: string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
