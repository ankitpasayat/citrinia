// The card under a peel that carries a link: what is on the other end of it.
//
// The whole card is the link, which it can be because nothing inside it is one
// -- unlike the quote card, whose body has @handles in it and therefore needs a
// stretched link instead. It opens in a new tab: the reader is going somewhere
// else, and coming back to a feed that has scrolled itself is worse.
//
// The site line and the href come from `preview.url`, which is the url in the
// peel's own text. Nothing else on the card does, and that is deliberate: any
// signed-in person can write a row into link_previews (the app holds only the
// anon key), so the title and the description are somebody's claim about the
// page while the hostname is a fact about where the tap goes. See the migration.
import * as stylex from "@stylexjs/stylex";
import { bp, colors } from "@/app/tokens.stylex";
import { previewSite, type LinkPreview } from "@/lib/link-preview";

export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      {...stylex.props(styles.card)}
    >
      {/* Somebody else's CDN, like every other picture here; see media-grid.tsx.
          Decorative: the title underneath is the card's accessible name. */}
      {preview.image_url !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- see media-grid.tsx
        <img
          src={preview.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          {...stylex.props(styles.image)}
        />
      )}
      <span {...stylex.props(styles.lines)}>
        <span {...stylex.props(styles.site)}>{previewSite(preview.url)}</span>
        {/* A page that gave up no title at all still says where it goes. */}
        {preview.title !== null && <span {...stylex.props(styles.title)}>{preview.title}</span>}
        {preview.description !== null && (
          <span {...stylex.props(styles.description)}>{preview.description}</span>
        )}
      </span>
    </a>
  );
}

const styles = stylex.create({
  card: {
    display: "block",
    marginBottom: 10,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: colors.apricotLip,
    borderRadius: 16,
    backgroundColor: colors.chip,
    color: colors.ink,
    textDecorationLine: "none",
    overflow: "hidden",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
    borderBottomColor: {
      default: colors.apricotLip,
      [bp.hover]: { default: colors.apricotLip, ":hover": colors.burnt },
    },
  },
  // 16:9 and a background, so the card does not jump when the picture lands.
  image: {
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover",
    backgroundColor: colors.surface,
  },
  lines: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: 10,
    paddingInline: 12,
    minWidth: 0,
  },
  site: {
    fontSize: "0.75rem",
    fontWeight: 800,
    color: colors.muted,
    textTransform: "lowercase",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  title: {
    fontSize: "0.9375rem",
    fontWeight: 800,
    lineHeight: 1.3,
    // One line: the title is the headline, the description is the rest.
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  description: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: colors.muted,
    // Two lines, and the third is cut with an ellipsis.
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
  },
});
