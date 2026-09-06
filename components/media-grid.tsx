// A peel's attachments. One fills the card; two to four share a square grid.
// Pictures are plain <img>: the urls are public Storage objects and other
// people's CDNs, so there is nothing for next/image's optimizer to be pointed
// at. Tapping one opens the peel (there is no lightbox in this MVP), except on
// the peel page itself, where `embed` also swaps the YouTube still for a player.
// Server-safe.
/* eslint-disable @next/next/no-img-element -- public Storage objects and remote
   CDNs; there is no optimizer domain config to point next/image at. */
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { colors } from "@/app/tokens.stylex";
import { youtubeId, youtubeThumbnail } from "@/lib/media";
import { PlayIcon } from "./icons";
import { Pill } from "./pill";
import { YouTubeEmbed } from "./youtube-embed";

const MAX_HEIGHT = 480;

export function MediaGrid({
  media,
  href,
  authorName,
  embed = false,
}: {
  media: PeelMedia[];
  /** The peel this media hangs off; pictures link there in the feed. */
  href: string;
  /** Names the player for a screen reader, since the video's own title is YouTube's. */
  authorName: string;
  /** On the peel page: play YouTube inline, and stop linking to the page we are on. */
  embed?: boolean;
}) {
  if (media.length === 0) return null;

  const [first] = media;
  if (media.length === 1 && first.kind === "video") {
    return (
      <video
        src={first.url}
        controls
        playsInline
        preload="metadata"
        aria-label={first.alt || `Video by ${authorName}`}
        {...stylex.props(styles.video)}
      />
    );
  }

  if (media.length === 1 && first.kind === "youtube") {
    const id = youtubeId(first.url);
    // A link we cannot read an id out of is not a card, it is just a link in the text.
    if (id === null) return null;
    if (embed) return <YouTubeEmbed id={id} title={`YouTube video shared by ${authorName}`} />;
    return (
      <Link href={href} aria-label={`YouTube video shared by ${authorName}`} {...stylex.props(styles.tube)}>
        <img
          src={youtubeThumbnail(id)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          {...stylex.props(styles.cover)}
        />
        <span {...stylex.props(styles.play)} aria-hidden="true">
          <PlayIcon />
        </span>
        <Pill style={styles.badge}>YouTube</Pill>
      </Link>
    );
  }

  if (media.length === 1) {
    return (
      <Picture item={first} href={embed ? null : href} style={styles.single} ratio={ratioOf(first)} />
    );
  }

  return (
    <div {...stylex.props(styles.grid)}>
      {media.map((item, index) => (
        <Picture
          key={`${index}-${item.url}`}
          item={item}
          href={embed ? null : href}
          style={styles.tile}
          ratio="1"
        />
      ))}
    </div>
  );
}

/** One image or gif, wrapped in a link to the peel unless we are already on it. */
function Picture({
  item,
  href,
  style,
  ratio,
}: {
  item: PeelMedia;
  href: string | null;
  style: stylex.StyleXStyles;
  ratio: string | null;
}) {
  const picture = (
    <>
      <img
        src={item.url}
        alt={item.alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        {...stylex.props(styles.cover, ratio !== null && aspect.of(ratio))}
      />
      {/* A gif animates on its own; the badge is what says it will. */}
      {item.kind === "gif" && <Pill style={styles.badge}>GIF</Pill>}
    </>
  );
  return href === null ? (
    <div {...stylex.props(styles.shell, style)}>{picture}</div>
  ) : (
    <Link href={href} {...stylex.props(styles.shell, styles.linked, style)}>
      {picture}
    </Link>
  );
}

/** The picture's own shape, when it came with one; otherwise let it be its natural height. */
function ratioOf(item: PeelMedia): string | null {
  return item.width && item.height ? `${item.width} / ${item.height}` : null;
}

const aspect = stylex.create({
  of: (ratio: string) => ({ aspectRatio: ratio }),
});

const styles = stylex.create({
  video: {
    display: "block",
    width: "100%",
    maxHeight: MAX_HEIGHT,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
    marginBottom: 10,
  },
  shell: {
    position: "relative",
    display: "block",
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: colors.chip,
    textDecorationLine: "none",
  },
  linked: {
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  single: { marginBottom: 10, maxHeight: MAX_HEIGHT },
  tile: { aspectRatio: "1" },
  cover: {
    display: "block",
    width: "100%",
    height: "100%",
    maxHeight: MAX_HEIGHT,
    objectFit: "cover",
  },
  tube: {
    position: "relative",
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    marginBottom: 10,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: colors.chip,
    textDecorationLine: "none",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  play: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    display: "grid",
    placeItems: "center",
    width: 56,
    height: 56,
    borderRadius: "50%",
    // onButton is the constant off-white the brand uses on top of colour, so the
    // disc reads the same in both schemes.
    backgroundColor: colors.onButton,
    color: colors.burnt,
    fontSize: "1.5rem",
    boxShadow: colors.shadowLg,
  },
  badge: {
    position: "absolute",
    left: 8,
    bottom: 8,
    fontSize: "0.625rem",
  },
});
