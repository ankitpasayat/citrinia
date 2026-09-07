// Link previews, the half that is only arithmetic: which link in a peel gets a
// card, what the card says it is, and which addresses the fetcher is allowed to
// go anywhere near. The fetching itself is lib/link-preview-fetch.ts, which is
// server-only; everything here runs anywhere and is unit tested.
import { youtubeId } from "./media.ts";
import { tokenize } from "./text.ts";

/** The caps in link_previews' own check constraints, so the app trims rather than fails. */
export const MAX_PREVIEW_TITLE = 200;
export const MAX_PREVIEW_DESCRIPTION = 400;

/** A row of link_previews, as the card reads it. `url` is the key and the truth. */
export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
};

/**
 * The link a peel gets a card for: the first one in the text that is not a
 * YouTube link, since those are already a player and a still.
 *
 * The same function answers on the way in (the server action, deciding what to
 * fetch) and on the way out (the hydrate, deciding which row to look up), which
 * is what lets the table be keyed by url with no column on peels.
 */
export function firstPreviewLink(text: string): string | null {
  for (const token of tokenize(text)) {
    if (token.type !== "link") continue;
    if (youtubeId(token.value) !== null) continue;
    return token.value;
  }
  return null;
}

/**
 * What the card says the link goes to: the hostname, without a leading `www.`.
 *
 * Built from the url every time it is shown, never from the stored row -- the
 * row can be written by anybody signed in (see the migration), the url cannot be
 * anything but the one in the peel's own text.
 */
export function previewSite(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Collapse the whitespace an OG tag was pretty-printed with, and cut it to size. */
function clamp(value: string, max: number): string | null {
  const said = value.replace(/\s+/g, " ").trim();
  if (said === "") return null;
  return said.length <= max ? said : `${said.slice(0, max - 1)}…`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** `&amp;` and friends. Titles are full of them, and a card is not HTML. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key];
    const numeric = /^#x([0-9a-f]+)$/i.exec(name) ?? /^#([0-9]+)$/.exec(name);
    if (!numeric) return whole;
    const code = Number.parseInt(numeric[1], /^#x/i.test(name) ? 16 : 10);
    // A lone surrogate or a code point past the end of Unicode is not a character.
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : whole;
  });
}

/** One attribute off a tag, quoted either way or not at all. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'\`=<>]+))`,
    "i",
  ).exec(tag);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

export type OpenGraph = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

/**
 * The Open Graph tags of a page, as a card's three lines.
 *
 * A regex over `<meta>` tags rather than a parser, because a parser is a
 * dependency and this reads four attributes out of the head of a document we
 * already refuse to read more than half a megabyte of. Only the head is looked
 * at: `<meta>` in the body is not metadata, and stopping there bounds the work.
 *
 * `og:title` and `og:description` come first because they are what the page
 * chose to be shared as; `<title>` and `<meta name=description>` are the
 * fallbacks, which is what makes a page with no OG tags at all still give the
 * compact row rather than nothing.
 */
export function parseOpenGraph(html: string, pageUrl: string): OpenGraph {
  const head = html.split(/<\/head\s*>/i)[0];

  const found = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");
    if (!key || content === null || content === "") continue;
    // First one wins: a page that says og:title twice meant the first.
    if (!found.has(key)) found.set(key, content);
  }

  const documentTitle = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const title = found.get("og:title") ?? (documentTitle ? decodeEntities(documentTitle[1]) : "");
  const description = found.get("og:description") ?? found.get("description") ?? "";
  const image = found.get("og:image") ?? found.get("og:image:url") ?? "";

  return {
    title: clamp(title, MAX_PREVIEW_TITLE),
    description: clamp(description, MAX_PREVIEW_DESCRIPTION),
    imageUrl: absoluteImage(image, pageUrl),
  };
}

/**
 * An og:image as something an `<img>` can be pointed at: absolute, and http(s).
 * Relative is normal and resolves against the page; a `data:` or `javascript:`
 * url is neither, and the one thing on the card that becomes an attribute in
 * somebody else's browser is the one to be strict about.
 */
function absoluteImage(raw: string, pageUrl: string): string | null {
  if (raw.trim() === "") return null;
  try {
    const resolved = new URL(raw.trim(), pageUrl);
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return null;
    return resolved.href.length <= 2048 ? resolved.href : null;
  } catch {
    return null;
  }
}

//------------------------------------------------------------------------------
// Where the fetcher may go
//------------------------------------------------------------------------------

/**
 * Is this address out on the internet, rather than somewhere only this server
 * can reach?
 *
 * This is the whole of the SSRF defence, and it is deliberately a check on the
 * ADDRESS rather than on the hostname: a name can be made to resolve anywhere,
 * including 169.254.169.254, and "does the url look internal" is a question
 * about a string that an attacker writes. lib/link-preview-fetch.ts hands this
 * every address the resolver returns and connects to nothing else, so a name
 * that resolves inward is refused however innocent it reads.
 *
 * The default answer is no: anything not understood is not public.
 */
export function isPublicAddress(ip: string, family?: number): boolean {
  const address = ip.trim().toLowerCase();
  if (family === 4 || /^\d+\.\d+\.\d+\.\d+$/.test(address)) return isPublicV4(address);
  return isPublicV6(address);
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a, b] = octets;

  if (a === 0) return false; // "this network", and 0.0.0.0 is every local interface
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && octets[2] === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 88 && octets[2] === 99) return false; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicV6(address: string): boolean {
  // An IPv4-mapped or IPv4-compatible address is an IPv4 address wearing a hat.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return isPublicV4(mapped[1]);

  const groups = expandV6(address);
  if (groups === null) return false;
  if (groups.every((group) => group === 0)) return false; // ::, the unspecified address
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false; // ::1

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7, unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10, link-local
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10, the deprecated site-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8, multicast
  // 2002::/16 (6to4) and 64:ff9b::/96 (NAT64) carry an IPv4 address inside them,
  // which is a way to reach a private v4 host through a public-looking v6 one.
  if (first === 0x2002) return false;
  if (first === 0x0064 && groups[1] === 0xff9b) return false;
  return true;
}

/** The eight groups of an IPv6 address, `::` expanded, or null if it is not one. */
function expandV6(address: string): number[] | null {
  const zone = address.split("%")[0];
  const halves = zone.split("::");
  if (halves.length > 2) return null;

  const parse = (half: string): number[] | null => {
    if (half === "") return [];
    const groups: number[] = [];
    for (const part of half.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail];
}
