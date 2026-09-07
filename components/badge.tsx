// The little burnt disc that hangs off an icon in the navigation. The bell's and
// the envelope's are the same badge with a different thing to count, so it is one
// piece of markup with two counters behind it. Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, shape } from "@/app/tokens.stylex";

export function Badge({ count, label }: { count: number; label: (n: number) => string }) {
  if (count === 0) return null;

  return (
    // `img`, not `status`: the count belongs to the icon's accessible name, and a
    // live region here would announce itself on every single navigation.
    <span role="img" aria-label={label(count)} {...stylex.props(styles.badge)}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

const styles = stylex.create({
  badge: {
    position: "absolute",
    top: -5,
    insetInlineEnd: -9,
    display: "grid",
    placeItems: "center",
    minWidth: 17,
    height: 17,
    paddingInline: 4,
    borderRadius: shape.pill,
    backgroundColor: colors.burnt,
    color: colors.onButton,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
  },
});
