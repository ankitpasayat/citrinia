// The YouTube half of media. The embed is the player itself, on the peel page
// only (the feed shows a still, so a scroll never starts twenty players); the
// helpers below are how a composer notices a link in what somebody typed.
// Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors } from "@/app/tokens.stylex";
import { youtubeId } from "@/lib/media";

/** nocookie, lazy: nothing is fetched from YouTube until the player scrolls near. */
export function YouTubeEmbed({ id, title }: { id: string; title: string }) {
  return (
    <div {...stylex.props(styles.frame)}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        {...stylex.props(styles.iframe)}
      />
    </div>
  );
}

/**
 * The first YouTube link in some text, or null. https only, because peel_media
 * rejects anything else. Trailing punctuation is the sentence's, not the url's.
 */
export function youtubeUrlIn(text: string): string | null {
  for (const match of text.match(/https:\/\/\S+/g) ?? []) {
    const url = match.replace(/[.,;:!?)\]}'"]+$/, "");
    if (youtubeId(url) !== null) return url;
  }
  return null;
}

/** That link as the composer's `media` field: one item, or none. */
export function youtubeMedia(text: string): PeelMedia[] {
  const url = youtubeUrlIn(text);
  // Alt text is the video's own title, which YouTube renders; ours would be a guess.
  return url === null ? [] : [{ kind: "youtube", url, alt: "", width: null, height: null }];
}

const styles = stylex.create({
  frame: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    marginBottom: 10,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.chip,
  },
  iframe: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderStyle: "none",
  },
});
