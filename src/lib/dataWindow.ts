import { addDays } from "./dates";

/**
 * The tenant copy's real activity range. Defaults and presets follow it so a demo never opens on
 * an empty period. La Rosaleda's local copy has real volume from Oct 2021 to 22 Mar 2022.
 */
export const DATA_WINDOW = {
  from: process.env.NEXT_PUBLIC_DATA_FROM ?? "2021-10-01",
  to: process.env.NEXT_PUBLIC_DATA_TO ?? "2022-03-22",
};

export const DEFAULT_RANGE = { from: "2022-01-01", to: DATA_WINDOW.to };

export function presets(): { label: string; from: string; to: string }[] {
  const t = DATA_WINDOW.to;
  return [
    { label: "Last 4 weeks", from: addDays(t, -27), to: t },
    { label: "Last 12 weeks", from: addDays(t, -83), to: t },
    { label: "Jan–Mar 2022", from: "2022-01-01", to: t },
    { label: "Q4 2021", from: "2021-10-01", to: "2021-12-31" },
    { label: "All data", from: DATA_WINDOW.from, to: t },
  ];
}
