// A peel's body. The text is plain, so the only markup is what lib/text.ts finds
// in it: @handles go to a profile, #hashtags go to that tag on Explore, and a
// link goes where it says. Line breaks are the author's, so they are kept.
// Server-safe.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { Fragment } from "react";
import { bp, colors } from "@/app/tokens.stylex";
import { tokenize } from "@/lib/text";

export function RichText({ text, style }: { text: string; style?: stylex.StyleXStyles }) {
  return (
    <p {...stylex.props(styles.body, style)}>
      {tokenize(text).map((token, index) => {
        // The index is the key because the list is derived from `text` alone and
        // never reorders: two identical tokens are genuinely interchangeable.
        if (token.type === "mention") {
          return (
            <Link key={index} href={`/u/${token.handle}`} {...stylex.props(styles.link)}>
              {token.value}
            </Link>
          );
        }
        // A link out of the app, so a plain <a> rather than next/link: there is
        // nothing to prefetch. The text stays exactly as it was typed -- shortening
        // somebody's url is a way of showing them something they did not write.
        if (token.type === "link") {
          return (
            <a
              key={index}
              href={token.value}
              target="_blank"
              rel="noopener noreferrer nofollow"
              {...stylex.props(styles.link)}
            >
              {token.value}
            </a>
          );
        }
        if (token.type === "hashtag") {
          return (
            <Link
              key={index}
              href={`/explore?q=${encodeURIComponent(token.value)}`}
              {...stylex.props(styles.link)}
            >
              {token.value}
            </Link>
          );
        }
        return <Fragment key={index}>{token.value}</Fragment>;
      })}
    </p>
  );
}

const styles = stylex.create({
  body: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: "0.9375rem",
    fontWeight: 600,
    lineHeight: 1.5,
    // The author's own line breaks, and a long unbroken url that never widens the card.
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  link: {
    // Relative so a quote card's stretched link cannot swallow these; see quote-card.tsx.
    position: "relative",
    zIndex: 2,
    color: colors.burnt,
    fontWeight: 800,
    textDecorationLine: {
      default: "none",
      [bp.hover]: { default: "none", ":hover": "underline" },
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
    borderRadius: 4,
  },
});
