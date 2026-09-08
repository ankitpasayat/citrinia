// The peel a quote embeds, shown compactly inside the quoting card and as the
// composer's preview. The whole card opens the quoted peel, which normally means
// wrapping it in a link -- but the body already has links in it (@handles,
// #hashtags), and an <a> inside an <a> is not valid HTML. So the card is a plain
// element with one stretched link laid over it, and the body's own links sit
// above that (rich-text.tsx gives them z-index 2). Nothing nests.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { colors, fonts } from "@/app/tokens.stylex";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { Avatar } from "./avatar";
import { KindBadge } from "./kind-badge";
import { RichText } from "./rich-text";

export function QuoteCard({
  quote,
  linked = true,
}: {
  quote: PeelUnionAuthor;
  /** The composer shows this as a preview, where a link out of the sheet is a trap. */
  linked?: boolean;
}) {
  const author = quote.author;
  const first = quote.media[0];

  return (
    <div {...stylex.props(styles.card)}>
      {linked && (
        <Link
          href={`/p/${quote.id}`}
          aria-label={`Peel by ${author.name}`}
          {...stylex.props(styles.stretch)}
        />
      )}

      <div {...stylex.props(styles.who)}>
        <Avatar src={author.avatar_url} name={author.name} size="sm" />
        <b {...stylex.props(styles.name)}>{author.name}</b>
        <span {...stylex.props(styles.meta)}>
          @{author.username} <KindBadge kind={author.kind} />
        </span>
        <time
          dateTime={quote.created_at}
          title={fullTime(quote.created_at)}
          suppressHydrationWarning
          {...stylex.props(styles.meta, styles.time)}
        >
          {formatRelative(quote.created_at)}
        </time>
      </div>

      <RichText text={quote.title} style={styles.body} />

      {/* One thumbnail is enough to say "there are pictures on it"; the peel has the rest. */}
      {first && first.kind !== "youtube" && first.kind !== "video" && (
        <div {...stylex.props(styles.thumbs)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- see media-grid.tsx */}
          <img
            src={first.url}
            alt={first.alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            {...stylex.props(styles.thumb)}
          />
          {quote.media.length > 1 && (
            <span {...stylex.props(styles.more)}>+{quote.media.length - 1}</span>
          )}
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  card: {
    position: "relative",
    marginBottom: 10,
    paddingBlock: 12,
    paddingInline: 12,
    backgroundColor: colors.chip,
    borderRadius: 16,
  },
  // Covers the card so a tap anywhere on it opens the quoted peel. z-index 1
  // puts it over the plain text and under the body's own links (z-index 2).
  stretch: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    borderRadius: 16,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  who: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  name: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "0.875rem",
    lineHeight: 1.2,
    color: colors.burnt,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: { fontSize: "0.75rem", fontWeight: 700, color: colors.muted },
  time: { marginLeft: "auto", flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  body: { marginTop: 4, marginBottom: 0, fontSize: "0.875rem" },
  thumbs: { position: "relative", display: "flex", alignItems: "center", gap: 6, marginTop: 8 },
  thumb: {
    width: 64,
    height: 64,
    objectFit: "cover",
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  more: { fontSize: "0.75rem", fontWeight: 800, color: colors.muted },
});
