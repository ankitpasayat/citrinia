// GitHub picture when we have one, otherwise initials on amber. Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "@/app/tokens.stylex";

type Props = {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  /** Cocoa ring, used when the avatar is a button (account menu). */
  ring?: boolean;
  style?: stylex.StyleXStyles;
};

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

export function Avatar({ src, name, size = "md", ring = false, style }: Props) {
  return (
    <span {...stylex.props(styles.base, sizes[size], ring && styles.ring, style)} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote GitHub avatars, no optimizer config needed */}
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" {...stylex.props(styles.img)} /> : initials(name)}
    </span>
  );
}

const styles = stylex.create({
  base: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: "50%",
    backgroundColor: colors.amber,
    color: colors.onStripe,
    fontFamily: fonts.body,
    fontWeight: 800,
    lineHeight: 1,
    userSelect: "none",
  },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  ring: { borderWidth: 3, borderStyle: "solid", borderColor: colors.onStripe },
});

const sizes = stylex.create({
  sm: { width: 30, height: 30, fontSize: "0.6875rem" },
  md: { width: 40, height: 40, fontSize: "0.875rem" },
  lg: { width: 84, height: 84, fontSize: "1.75rem", borderWidth: 4, borderStyle: "solid", borderColor: colors.surface, boxShadow: colors.shadow },
});
