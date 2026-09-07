import { countChars } from "./peel.ts";

// A profile name is 1 to 50 characters and a bio is up to 160, both after
// trimming. Characters are counted as code points to match Postgres
// char_length() in the profiles_bio_length check.
export const MAX_NAME = 50;
export const MAX_BIO = 160;
export const MAX_LOCATION = 30;
/** Including the `https://` we store, because the column counts that too. */
export const MAX_WEBSITE = 100;

/** Runs of two or more line breaks (blank lines may hold spaces or tabs). */
const BLANK_LINES = /\n[ \t]*(?:\n[ \t]*)+/g;

/**
 * The link on a profile, as we will store it: an `https://` url, or `''`.
 *
 * A bare host gets the scheme it meant, and `http://` is upgraded rather than
 * refused -- somebody typing it means "my site", not "in cleartext please".
 * Every other scheme is refused, `javascript:` above all: this string is handed
 * to an href on a page other people read.
 *
 * Credentials are refused too, because `https://apple.com@evil.example` reads
 * as apple.com to anyone skimming it, and the host is all the profile shows.
 */
export function parseWebsite(raw: unknown): { website: string } | { error: string } {
  const typed = (typeof raw === "string" ? raw : "").trim();
  if (typed === "") return { website: "" };

  // A scheme is letters/digits/+/-/. before a colon -- but so is the host in
  // `ada.example:8443`, and the colon there starts a port. A digit right after
  // the colon means a port, and a real scheme is never followed by a bare
  // number; anything that gets through as a port and is not one fails the URL
  // parse below, which is a refusal either way.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(typed)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "https" && scheme !== "http") {
    return { error: "A link has to start with https://" };
  }
  const withScheme = scheme === undefined ? `https://${typed}` : `https://${typed.slice(scheme.length + 1).replace(/^\/\//, "")}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: "That doesn't look like a link." };
  }
  if (url.username !== "" || url.password !== "") {
    return { error: "Leave the part before the @ out of your link." };
  }
  // A host with no dot is a machine on somebody's network, not a website.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) {
    return { error: "That doesn't look like a link." };
  }

  // `new URL` normalises: it lowercases the host, punycodes it, and percent-
  // encodes the rest, so what we store is what a browser would have gone to.
  // A bare host keeps no trailing slash -- it is a link, not a directory.
  const website = url.pathname === "/" && url.search === "" && url.hash === ""
    ? `${url.protocol}//${url.host}`
    : url.href;
  if (countChars(website) > MAX_WEBSITE) {
    return { error: `That link's too long. ${MAX_WEBSITE} characters at most.` };
  }
  return { website };
}

/** The link as a profile shows it: no scheme, no trailing slash. Display only. */
export function displayWebsite(website: string): string {
  return website.replace(/^https:\/\//, "").replace(/\/$/, "");
}

export function parseProfile(input: {
  name: unknown;
  bio?: unknown;
  location?: unknown;
  website?: unknown;
}): { name: string; bio: string; location: string; website: string } | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) return { error: "Add a name." };
  const nameOver = countChars(name) - MAX_NAME;
  if (nameOver > 0) {
    return { error: `That name's ${nameOver} over. A name is 1 to ${MAX_NAME} characters.` };
  }

  const bio = (typeof input.bio === "string" ? input.bio : "")
    .replace(/\r\n?/g, "\n")
    .replace(BLANK_LINES, "\n\n")
    .trim();
  const bioOver = countChars(bio) - MAX_BIO;
  if (bioOver > 0) {
    return { error: `That bio's ${bioOver} over. A bio is up to ${MAX_BIO} characters.` };
  }

  // One line, however it was pasted: a location sits inline next to a date.
  const location = (typeof input.location === "string" ? input.location : "")
    .replace(/\s+/g, " ")
    .trim();
  const locationOver = countChars(location) - MAX_LOCATION;
  if (locationOver > 0) {
    return { error: `That location's ${locationOver} over. ${MAX_LOCATION} characters at most.` };
  }

  const link = parseWebsite(input.website);
  if ("error" in link) return { error: link.error };

  return { name, bio, location, website: link.website };
}
