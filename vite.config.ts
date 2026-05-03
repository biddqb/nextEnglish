import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-recommended Vite settings:
// - fixed dev port 1420 (matches tauri.conf.json devUrl)
// - strict port (don't auto-pick another)
// - hmr fallback over IPC for Tauri dev windows
//
// https://tauri.app/v2/develop/integrations/vite/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1421,
    },
    watch: {
      // Don't trigger frontend rebuilds when Rust files change.
      ignored: ["**/src-tauri/**", "**/sidecar/**"],
    },
  },
}));
