// Explicit light/dark overrides for the user's manual choice. With neither theme
// applied to <html>, the tokens follow prefers-color-scheme (the "system" setting).
import * as stylex from "@stylexjs/stylex";
import { colors, gradients } from "./tokens.stylex";

export const darkTheme = stylex.createTheme(colors, {
  scheme: "dark",
  ground: "#2A1A12",
  surface: "#36251B",
  ink: "#FFF1E6",
  muted: "#D0B29E",
  burnt: "#F0763A",
  apricot: "#7A4A30",
  apricotLip: "#5C3622",
  chip: "#3F2B20",
  lip: "#1A0F0A",
  danger: "#FF7B6B",
  dangerSoft: "#4A211C",
  dim: "rgba(0,0,0,0.55)",
  shadow: "0 6px 20px rgba(0,0,0,0.3)",
  shadowLg: "0 10px 30px rgba(0,0,0,0.4)",
});

export const lightTheme = stylex.createTheme(colors, {
  scheme: "light",
  ground: "#FFF1E6",
  surface: "#FFFAF5",
  ink: "#4A2C1A",
  muted: "#8C6A52",
  burnt: "#D4551B",
  apricot: "#FFC9A3",
  apricotLip: "#E8A876",
  chip: "#FFF1E6",
  lip: "#4A2C1A",
  danger: "#C62828",
  dangerSoft: "#FFE0DC",
  dim: "rgba(74,44,26,0.35)",
  shadow: "0 6px 20px rgba(74,44,26,0.08)",
  shadowLg: "0 10px 30px rgba(74,44,26,0.15)",
});

export const darkGradients = stylex.createTheme(gradients, {
  secondary: "linear-gradient(#8A5638, #7A4A30)",
});

export const lightGradients = stylex.createTheme(gradients, {
  secondary: "linear-gradient(#FFE1C7, #FFC9A3)",
});

export type ThemeSetting = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "theme";

/** Class names to put on <html> for each explicit setting. */
export const themeClassNames = {
  dark: stylex.props(darkTheme, darkGradients).className ?? "",
  light: stylex.props(lightTheme, lightGradients).className ?? "",
};
