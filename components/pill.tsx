// Small status pills: the character counter and the Live indicator.
import * as stylex from "@stylexjs/stylex";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

type Tone = "mustard" | "amber" | "danger";

export function Pill({ tone = "mustard", children, style }: { tone?: Tone; children: React.ReactNode; style?: stylex.StyleXStyles }) {
  return <span {...stylex.props(styles.pill, tones[tone], style)}>{children}</span>;
}

export function LivePill() {
  return (
    <Pill>
      <span {...stylex.props(styles.dot)} aria-hidden="true" />
      Live
    </Pill>
  );
}

const styles = stylex.create({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.75rem",
    lineHeight: 1,
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums",
    borderRadius: shape.pill,
    paddingBlock: 7,
    paddingInline: 11,
    whiteSpace: "nowrap",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: "#D4551B",
    animationName: stylex.keyframes({ "50%": { opacity: 0.35 } }),
    animationDuration: { default: "2s", [bp.reduce]: "0s" },
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
});

const tones = stylex.create({
  mustard: { backgroundColor: colors.mustard, color: colors.onStripe },
  amber: { backgroundColor: colors.amber, color: colors.onStripe },
  danger: { backgroundColor: colors.danger, color: "#FFFFFF" },
});
