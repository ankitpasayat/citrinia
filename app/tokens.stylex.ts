// Creamsicle design tokens. This file may only contain defineVars / defineConsts
// (a StyleX rule). Components read these; no literal colors elsewhere except the
// stripe and gradient constants below, which are the brand and never change.
import * as stylex from "@stylexjs/stylex";

const DARK = "@media (prefers-color-scheme: dark)";

export const colors = stylex.defineVars({
  scheme: { default: "light", [DARK]: "dark" },
  ground: { default: "#FFF1E6", [DARK]: "#2A1A12" },
  surface: { default: "#FFFAF5", [DARK]: "#36251B" },
  ink: { default: "#4A2C1A", [DARK]: "#FFF1E6" },
  muted: { default: "#8C6A52", [DARK]: "#D0B29E" },
  burnt: { default: "#D4551B", [DARK]: "#F0763A" },
  amber: "#F0A030",
  mustard: "#E8C547",
  soft: "#F7E0C0",
  apricot: { default: "#FFC9A3", [DARK]: "#7A4A30" },
  apricotLip: { default: "#E8A876", [DARK]: "#5C3622" },
  chip: { default: "#FFF1E6", [DARK]: "#3F2B20" },
  lip: { default: "#4A2C1A", [DARK]: "#1A0F0A" },
  onButton: "#FFF8EC",
  onStripe: "#4A2C1A",
  danger: { default: "#C62828", [DARK]: "#FF7B6B" },
  dangerSoft: { default: "#FFE0DC", [DARK]: "#4A211C" },
  dim: { default: "rgba(74,44,26,0.35)", [DARK]: "rgba(0,0,0,0.55)" },
  shadow: { default: "0 6px 20px rgba(74,44,26,0.08)", [DARK]: "0 6px 20px rgba(0,0,0,0.3)" },
  shadowLg: { default: "0 10px 30px rgba(74,44,26,0.15)", [DARK]: "0 10px 30px rgba(0,0,0,0.4)" },
});

export const fonts = stylex.defineVars({
  display: '"Shrikhand", "Cooper Black", "Arial Rounded MT Bold", serif',
  body: '"Nunito", "Segoe UI", Roboto, sans-serif',
});

export const shape = stylex.defineVars({
  card: "24px",
  sheet: "28px",
  field: "18px",
  band: "20px",
  pill: "999px",
  lip: "4px",
  column: "520px",
});

export const gradients = stylex.defineVars({
  button: "linear-gradient(#F0A030, #D4551B)",
  secondary: { default: "linear-gradient(#FFE1C7, #FFC9A3)", [DARK]: "linear-gradient(#8A5638, #7A4A30)" },
  danger: "linear-gradient(#FF8A7A, #C62828)",
  stripes: "linear-gradient(#D4551B 0 25%, #F0A030 25% 50%, #E8C547 50% 75%, #F7E0C0 75%)",
  handle: "linear-gradient(90deg, #D4551B 0 33%, #F0A030 33% 66%, #E8C547 66%)",
});

// Media queries as compile-time constants; use them as keys inside stylex.create.
export const bp = stylex.defineConsts({
  tablet: "@media (min-width: 600px)",
  /** Three columns: the icon rail, the feed and the aside. */
  desktop: "@media (min-width: 1024px)",
  /** The rail widens and its labels sit beside the icons. */
  wide: "@media (min-width: 1280px)",
  hover: "@media (hover: hover)",
  reduce: "@media (prefers-reduced-motion: reduce)",
});
