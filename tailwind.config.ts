import type { Config } from "tailwindcss";

// Translates UI_DESIGN.md tokens (App Shell Extensions) into Tailwind theme.
// Typography classes live in src/styles.css as plain CSS — easier to read than
// composing 5+ Tailwind classes for every font role.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f5f5",
        "canvas-soft": "#fafafa",
        "canvas-deep": "#0c0a09",
        "surface-card": "#ffffff",
        "surface-strong": "#f0efed",
        "surface-dark": "#0c0a09",
        "surface-dark-elevated": "#1c1917",
        ink: "#0c0a09",
        "ink-press": "#292524",
        body: "#4e4e4e",
        "body-strong": "#292524",
        muted: "#777169",
        "muted-soft": "#a8a29e",
        "on-primary": "#ffffff",
        "on-dark": "#ffffff",
        "on-dark-soft": "#a8a29e",
        hairline: "#e7e5e4",
        "hairline-soft": "#f0efed",
        "hairline-strong": "#d6d3d1",
        "gradient-mint": "#a7e5d3",
        "gradient-peach": "#f4c5a8",
        "gradient-lavender": "#c8b8e0",
        "gradient-sky": "#a8c8e8",
        "gradient-rose": "#e8b8c4",
        "semantic-success": "#16a34a",
        "semantic-error": "#dc2626",
      },
      spacing: {
        xxs: "4px",
        xs: "8px",
        sm: "12px",
        base: "16px",
        md: "20px",
        lg: "24px",
        xl: "32px",
        xxl: "48px",
        section: "96px",
        "app-section": "48px",
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        xxl: "24px",
      },
      fontFamily: {
        display: ["EB Garamond", "Georgia", "Times New Roman", "serif"],
        body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Cascadia Code", "JetBrains Mono", "monospace"],
      },
      boxShadow: {
        soft: "0 4px 16px rgba(0, 0, 0, 0.04)",
      },
      transitionDuration: {
        "200": "200ms",
        "400": "400ms",
        "600": "600ms",
      },
    },
  },
} satisfies Config;
