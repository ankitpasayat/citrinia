"use client";

// System / Light / Dark. "System" means no theme class on <html>, which lets the
// tokens fall back to prefers-color-scheme. The swap runs inside a view
// transition so every color cross-fades together (0.7s, app/globals.css).
import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { THEME_STORAGE_KEY, themeClassNames, type ThemeSetting as Setting } from "@/app/themes";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const OPTIONS = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const;

// localStorage is the store of record: app/layout.tsx reads the same key in an
// inline script to paint the theme before hydration. useSyncExternalStore is how
// React subscribes to it without a setState-in-effect cascade.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readSetting(): Setting {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system"; // Storage blocked; "system" is the right fallback.
  }
}

// No storage on the server, and the server render must match the pre-script HTML.
const serverSetting = (): Setting => "system";

// themeClassNames values are several classes in one string (the theme plus the
// gradient override). DOMTokenList.add/remove throw on a token containing a
// space, so split before touching the class list.
const tokens = (className: string) => className.split(" ").filter(Boolean);

function writeSetting(next: Setting) {
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Nothing to persist to; the class swap below still applies for this page.
  }
  for (const notify of listeners) notify();
}

export function ThemeSetting() {
  const setting = useSyncExternalStore(subscribe, readSetting, serverSetting);

  function choose(next: Setting) {
    if (next === setting) return;

    const apply = () => {
      // flushSync so the pressed segment is in the same snapshot as the new theme.
      flushSync(() => writeSetting(next));
      const classes = document.documentElement.classList;
      classes.remove(...tokens(themeClassNames.dark), ...tokens(themeClassNames.light));
      if (next !== "system") classes.add(...tokens(themeClassNames[next]));
    };

    const svt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof svt === "function" && !reduce) svt.call(document, apply);
    else apply();
  }

  return (
    <div {...stylex.props(styles.group)} role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={setting === value}
          onClick={() => choose(value)}
          {...stylex.props(styles.segment, setting === value && styles.selected)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

const styles = stylex.create({
  group: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    paddingBlock: 3,
    paddingInline: 3,
    backgroundColor: colors.chip,
    borderRadius: shape.pill,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    fontFamily: fonts.body,
    fontSize: "1rem",
    color: { default: colors.muted, [bp.hover]: { default: colors.muted, ":hover": colors.ink } },
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.pill,
    cursor: "pointer",
    touchAction: "manipulation",
    transitionProperty: "background-color, color",
    transitionDuration: { default: "120ms", [bp.reduce]: "0ms" },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  selected: {
    backgroundColor: colors.burnt,
    color: { default: colors.onButton, [bp.hover]: { default: colors.onButton, ":hover": colors.onButton } },
  },
});
