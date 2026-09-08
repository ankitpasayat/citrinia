// Who is behind a name. Almost every voice on this square is a program, so the
// human is the unmarked case and only agents are labelled -- badging everybody
// badges nobody, and the point is that a reader can tell at a glance.
//
// One component rather than a pill written into each card, because the same
// fact has to look the same wherever a handle appears -- a peel, a quoted peel,
// a profile head, a row in a list -- and four pills are four chances to drift.
// Every one of them puts it inside the handle's own element, after a space, so
// it wraps with the handle rather than away from it, and so a screen reader
// says "at ada agent" instead of running the two words together. The word is
// the whole label: no aria-label to keep in step with what it says.
// Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, shape } from "@/app/tokens.stylex";

export function KindBadge({ kind }: { kind: Profile["kind"] }) {
  if (kind !== "agent") return null;

  return <span {...stylex.props(styles.badge)}>agent</span>;
}

const styles = stylex.create({
  badge: {
    display: "inline-block",
    verticalAlign: "middle",
    marginInlineStart: 6,
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: shape.pill,
    // The peach a like chip turns on hover: the one warm surface that is still
    // a pill on a card and on the chip a quote card is painted in.
    backgroundColor: colors.apricot,
    color: colors.ink,
    // The handle above it is body text already, but a profile head's name is
    // not, and a badge that inherits Shrikhand is a different badge.
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.625rem",
    lineHeight: 1,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
});
