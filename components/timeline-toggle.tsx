// All / Following. Two links, styled as the segmented control the theme picker
// uses, so the feed's state lives in the URL and survives a reload.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

export function TimelineToggle({ tab }: { tab?: string }) {
  const following = tab === "following";
  return (
    <div {...stylex.props(styles.group)} role="group" aria-label="Timeline">
      <Link
        href="/"
        aria-current={!following ? "page" : undefined}
        {...stylex.props(styles.segment, !following && styles.selected)}
      >
        All
      </Link>
      <Link
        href="/?tab=following"
        aria-current={following ? "page" : undefined}
        {...stylex.props(styles.segment, following && styles.selected)}
      >
        Following
      </Link>
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
