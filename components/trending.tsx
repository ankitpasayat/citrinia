// What the day is talking about: the hashtags of the last 24 hours, ranked. A
// server component with its own client, so any screen can drop it in without
// threading a query through its props -- the same shape as who-to-follow.tsx.
// Renders nothing when nobody used a tag today, so a caller never has to check.
//
// Each row says both numbers, because the rank is decided on the second one:
// "3 peels from 1 person" sitting below "2 peels from 2 people" reads as the
// rule it is, where a bare peel count would read as a bug.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { fetchTrending } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

export async function Trending({ n = 5 }: { n?: number }) {
  const supabase = await createClient();
  const trends = await fetchTrending(supabase, n);
  if (trends.length === 0) return null;

  return (
    <section {...stylex.props(styles.card)}>
      <h2 {...stylex.props(styles.label)}>Trending today</h2>

      {trends.map((trend, index) => (
        <Link
          key={trend.tag}
          // The tag goes back through the same `q` a typed search uses, sigil
          // and all: one results page, one URL shape, one thing to share.
          href={`/explore?q=${encodeURIComponent(`#${trend.tag}`)}`}
          {...stylex.props(styles.row)}
        >
          <span {...stylex.props(styles.tag)}>
            <span {...stylex.props(styles.hash)}>#</span>
            {trend.tag}
          </span>
          <span {...stylex.props(styles.count)}>
            {count(trend.peels, "peel")} from {count(trend.people, "person", "people")}
          </span>
          {/* The position is decoration: the list is already in order, and a
              screen reader announcing "1" before every tag would only get in
              the way of the tag itself. */}
          <span {...stylex.props(styles.rank)} aria-hidden="true">
            {index + 1}
          </span>
        </Link>
      ))}
    </section>
  );
}

/** "1 peel", "12 peels", "1 person", "12 people". */
function count(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

const styles = stylex.create({
  card: {
    display: "grid",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 16,
    paddingInline: 16,
  },
  label: {
    margin: 0,
    marginBottom: 4,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: colors.burnt,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    columnGap: 12,
    rowGap: 2,
    alignItems: "center",
    minHeight: 44,
    paddingBlock: 8,
    paddingInline: 8,
    marginInline: -8,
    borderRadius: 16,
    textDecorationLine: "none",
    backgroundColor: {
      default: "transparent",
      [bp.hover]: { default: "transparent", ":hover": colors.chip },
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -1,
  },
  tag: {
    gridColumn: "1",
    fontWeight: 800,
    fontSize: "1rem",
    color: colors.ink,
    overflowWrap: "anywhere",
  },
  hash: { color: colors.burnt },
  count: { gridColumn: "1", fontSize: "0.8125rem", fontWeight: 700, color: colors.muted },
  rank: {
    gridColumn: "2",
    gridRow: "1 / span 2",
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.375rem",
    lineHeight: 1,
    color: colors.amber,
    fontVariantNumeric: "tabular-nums",
  },
});
