import type { Config } from "tailwindcss";

// Colours and type follow the Koronet design tokens (koronet-tokens.css).
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "monospace"],
      },
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)", bg2: "rgb(var(--bg2) / <alpha-value>)", bg3: "rgb(var(--bg3) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)", ink2: "rgb(var(--ink2) / <alpha-value>)", ink3: "rgb(var(--ink3) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)", line2: "rgb(var(--line2) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)", link: "rgb(var(--link) / <alpha-value>)",
        ok: { DEFAULT: "rgb(var(--ok) / <alpha-value>)", bg: "rgb(var(--ok-bg) / <alpha-value>)" },
        warn: { DEFAULT: "rgb(var(--warn) / <alpha-value>)", bg: "rgb(var(--warn-bg) / <alpha-value>)" },
        bad: { DEFAULT: "rgb(var(--bad) / <alpha-value>)", bg: "rgb(var(--bad-bg) / <alpha-value>)" },
      },
    },
  },
  plugins: [],
};
export default config;
