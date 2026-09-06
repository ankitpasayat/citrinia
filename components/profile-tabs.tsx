// Peels / Replies / Likes on a profile. Links, not buttons, so the tab lives in
// the URL and survives a reload or a share -- the same segmented control the
// timeline toggle uses. Server-safe.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

export type ProfileTab = "peels" | "replies" | "likes";

const TABS: { tab: ProfileTab; label: string }[] = [
  { tab: "peels", label: "Peels" },
  { tab: "replies", label: "Replies" },
  { tab: "likes", label: "Likes" },
];

/** Anything that is not a tab name is the default tab, so a hand-edited URL still renders. */
export function parseProfileTab(raw: string | undefined): ProfileTab {
  return raw === "replies" || raw === "likes" ? raw : "peels";
}

export function ProfileTabs({ username, tab }: { username: string; tab: ProfileTab }) {
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <div {...stylex.props(styles.group)} role="group" aria-label="Profile timeline">
      {TABS.map((item) => (
        <Link
          key={item.tab}
          href={item.tab === "peels" ? base : `${base}?tab=${item.tab}`}
          aria-current={item.tab === tab ? "page" : undefined}
          {...stylex.props(styles.segment, item.tab === tab && styles.selected)}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

const styles = stylex.create({
  group: {
    display: "inline-flex",
    alignSelf: "flex-start",
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
    minHeight: 44,
    paddingBlock: 8,
    paddingInline: 16,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    textDecorationLine: "none",
    color: { default: colors.muted, [bp.hover]: { default: colors.muted, ":hover": colors.ink } },
    borderRadius: shape.pill,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  selected: {
    backgroundColor: colors.burnt,
    color: {
      default: colors.onButton,
      [bp.hover]: { default: colors.onButton, ":hover": colors.onButton },
    },
  },
});
