// The stripe band: the brand mark. Full band on the feed with the wordmark and a
// right slot; slim (a bare stripe) on inner pages. Respects the top safe area.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { colors, fonts, gradients, shape } from "@/app/tokens.stylex";

export function Band({ slim = false, children }: { slim?: boolean; children?: React.ReactNode }) {
  if (slim) return <div {...stylex.props(styles.band, styles.slim)} aria-hidden="true" />;
  return (
    <header {...stylex.props(styles.band)}>
      <Link href="/" {...stylex.props(styles.wordmark)}>
        Citrinia
      </Link>
      <div {...stylex.props(styles.right)}>{children}</div>
    </header>
  );
}

export function Wordmark({ size = 32 }: { size?: number }) {
  return <span {...stylex.props(styles.wordmark, styles.wordmarkStatic)} style={{ fontSize: size }}>Citrinia</span>;
}

const styles = stylex.create({
  band: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 84,
    paddingInline: 18,
    borderRadius: shape.band,
    backgroundImage: gradients.stripes,
    boxShadow: colors.shadow,
  },
  slim: { height: 12, borderRadius: 6, paddingInline: 0, boxShadow: "none" },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "2rem",
    lineHeight: 1,
    letterSpacing: "0.01em",
    color: colors.onButton,
    textShadow: `2px 2px 0 ${colors.onStripe}`,
    textDecorationLine: "none",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 4,
    borderRadius: 8,
  },
  wordmarkStatic: { textShadow: `3px 3px 0 ${colors.onStripe}` },
  right: { display: "flex", alignItems: "center", gap: 10 },
});
