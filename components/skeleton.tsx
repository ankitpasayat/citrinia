// Shimmering placeholders while a route's data is in flight. Server-safe.
import * as stylex from "@stylexjs/stylex";
import { bp, colors, shape } from "@/app/tokens.stylex";

type Props = {
  width?: number | string;
  height?: number | string;
  /** Circular, for avatar placeholders. */
  round?: boolean;
  style?: stylex.StyleXStyles;
};

export function Skeleton({ width = "100%", height = 14, round = false, style }: Props) {
  return <span aria-hidden="true" {...stylex.props(styles.base, round && styles.round, size.of(width, height), style)} />;
}

/** One peel card's worth of placeholder: avatar column plus three lines. */
export function PeelSkeleton() {
  return (
    <div {...stylex.props(styles.card)}>
      <Skeleton width={40} height={40} round />
      <div {...stylex.props(styles.lines)}>
        <Skeleton width="40%" />
        <Skeleton width="92%" />
        <Skeleton width="70%" />
      </div>
    </div>
  );
}

const shimmer = stylex.keyframes({ to: { backgroundPosition: "-200% 0" } });

const styles = stylex.create({
  base: {
    display: "block",
    borderRadius: 8,
    backgroundColor: colors.chip,
    backgroundImage: `linear-gradient(90deg, ${colors.chip} 0%, ${colors.surface} 50%, ${colors.chip} 100%)`,
    backgroundSize: "200% 100%",
    animationName: { default: shimmer, [bp.reduce]: "none" },
    animationDuration: "1.4s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  round: { borderRadius: "50%" },
  card: {
    display: "grid",
    gridTemplateColumns: "40px 1fr",
    gap: 12,
    alignItems: "start",
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 16,
    paddingInline: 16,
  },
  lines: { display: "grid", gap: 8, alignContent: "start", paddingTop: 4 },
});

const size = stylex.create({
  of: (width: number | string, height: number | string) => ({ width, height }),
});
