// Media attached to a peel. The composer sends its attachments inside the
// `items` field, one list per box (see lib/thread.ts); this is the gate between
// that list and the peel_media table, so it enforces everything the table's
// check constraints do (https only, four kinds, 200 characters of alt) plus the
// two rules a constraint cannot see: at most four attachments, and a moving
// picture peels on its own.
import { countChars } from "./peel.ts";

export const MAX_MEDIA = 4;
export const MAX_ALT = 200;

const KINDS = ["image", "gif", "video", "youtube"] as const;
/** One of these fills the card on its own, so it cannot share a peel. */
const SOLO = new Set(["video", "youtube"]);
/** Alt text is what a screen reader reads instead of the picture. */
const NEEDS_ALT = new Set(["image", "gif"]);

/** The 11-character id in a YouTube link. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com"]);

/**
 * Parse one box's attachments. `null` and `undefined` both mean "nothing
 * attached" rather than an error, so a peel with no pictures is normal --
 * anything else has to be a list. Returns the rows to insert, in order, or one
 * short message for the composer.
 */
export function parseMedia(raw: unknown): PeelMedia[] | { error: string } {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: "Couldn't read that media." };
  if (raw.length === 0) return [];
  if (raw.length > MAX_MEDIA) return { error: `Four bits of media at most.` };

  const media: PeelMedia[] = [];
  for (const item of raw) {
    const one = parseOne(item);
    if ("error" in one) return one;
    media.push(one.media);
  }

  if (media.length > 1 && media.some((m) => SOLO.has(m.kind))) {
    return { error: "A video peels on its own." };
  }
  return media;
}

function parseOne(item: unknown): { media: PeelMedia } | { error: string } {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return { error: "Couldn't read that media." };
  }
  const raw = item as Record<string, unknown>;

  const kind = KINDS.find((k) => k === raw.kind);
  if (!kind) return { error: "That's not a kind of media we peel." };

  const url = parseUrl(raw.url);
  if (url === null) return { error: "Media needs an https link." };

  const alt = (typeof raw.alt === "string" ? raw.alt : "").trim();
  if (alt !== "" && countChars(alt) > MAX_ALT) {
    return { error: `That alt text is ${countChars(alt) - MAX_ALT} over. Alt text is up to ${MAX_ALT} characters.` };
  }
  if (alt === "" && NEEDS_ALT.has(kind)) {
    return { error: "Every image needs alt text." };
  }

  const width = parseSide(raw.width);
  const height = parseSide(raw.height);
  if (width === undefined || height === undefined) {
    return { error: "Those media dimensions don't look right." };
  }

  return { media: { kind, url, alt, width, height } };
}

/** https only, and a shape `new URL()` accepts. Returns the url with a lower-case scheme. */
function parseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // https only, except a loopback Storage URL from a local Supabase stack (a secure origin in browsers).
  if (!/^https:\/\//i.test(trimmed) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(trimmed)) return null;
  try {
    new URL(trimmed);
  } catch {
    return null;
  }
  // peel_media_url_https is a case-sensitive check, so normalise the scheme.
  if (/^http:\/\//i.test(trimmed)) return `http://${trimmed.slice("http://".length)}`;
  return `https://${trimmed.slice("https://".length)}`;
}

/** A pixel count, or null when absent. `undefined` means "given, but not a size". */
function parseSide(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) return undefined;
  return raw;
}

/** The video id in a youtube.com/watch, youtu.be or /shorts link, else null. */
export function youtubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1);
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (parsed.pathname.startsWith("/shorts/")) id = parsed.pathname.slice("/shorts/".length);
  }
  return id !== null && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * The object one of this project's public urls points at, as the `<uid>/<file>`
 * path inside `bucket` -- or null for any other url (a CDN, YouTube, a signed
 * url, a different bucket, another project), which is not ours to touch. The
 * inverse of what supabase-js getPublicUrl() builds. Peel media and profile
 * pictures live in different buckets and both delete through this.
 */
export function objectPath(url: string, supabaseUrl: string, bucket: string): string | null {
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length).split(/[?#]/, 1)[0];
  return path === "" ? null : path;
}

/** The still image for a video id. Served by YouTube, so no upload needed. */
export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
