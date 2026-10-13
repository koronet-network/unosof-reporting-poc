/**
 * Light and dark palettes from the Koronet tokens. globals.css carries the same values as RGB
 * channels for Tailwind; charts (ECharts, d3) read these hex values because they draw on canvas/SVG.
 */
export type Mode = "light" | "dark";

export const THEME = {
  light: {
    bg: "#ffffff", bg2: "#f7f8fa", bg3: "#e8f0f7",
    ink: "#121619", ink2: "#505459", ink3: "#567094",
    line: "#cedbe8", line2: "#e8ebef",
    accent: "#172b4d", compare: "#adc0d2", link: "#0055cc",
    band: "rgba(255,196,0,.16)", bandText: "#7a5b00",
    tooltipBg: "#121619", tooltipText: "#ffffff",
    heatLow: "#e8f0f7", heatHigh: "#172b4d",
    onCategory: "#ffffff",
    categories: ["#172b4d", "#0b95cb", "#00875a", "#8233d7", "#cc9900", "#d44726", "#567094", "#789d00", "#0055cc", "#bf2600"],
  },
  dark: {
    bg: "#121619", bg2: "#1f2225", bg3: "#2c4069",
    ink: "#f7f8fa", ink2: "#bdc2c7", ink3: "#adc0d2",
    line: "#363a3e", line2: "#2a2e32",
    accent: "#85a7ee", compare: "#567094", link: "#85a7ee",
    band: "rgba(255,218,102,.12)", bandText: "#ffda66",
    tooltipBg: "#f7f8fa", tooltipText: "#121619",
    heatLow: "#1f2a3a", heatHigh: "#cfe0ff",
    onCategory: "#121619",
    categories: ["#85a7ee", "#3dafd8", "#52bd92", "#a266e3", "#ffcf33", "#e06649", "#8ea2bd", "#aac93d", "#598be5", "#ed8b71"],
  },
} as const;
export type Palette = (typeof THEME)[Mode];
