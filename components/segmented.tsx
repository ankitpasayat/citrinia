// The segmented control: a pill of links, one of them current. The feed's
// All/Following toggle, a profile's Peels/Replies/Likes and a profile's
// Followers/Following are the same control, so it is built once here and each
// caller hands over the links it wants inside it. Server-safe.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

/**
 * One slot. `href` doubles as the key, so no two segments may share one. The
 * label is a node rather than a string because Requests carries a dot beside its
 * word -- everything else hands over plain text.
 */
export type Segment = { href: string; label: React.ReactNode; current: boolean };

export function Segmented({ label, segments }: { label: string; segments: Segment[] }) {
  return (
    <div {...stylex.props(styles.group)} role="group" aria-label={label}>
      {segments.map((segment) => (
        <Link
          key={segment.href}
          href={segment.href}
          aria-current={segment.current ? "page" : undefined}
          {...stylex.props(styles.segment, segment.current && styles.selected)}
        >
          {segment.label}
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
