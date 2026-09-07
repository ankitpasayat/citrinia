// Peel text. A peel is plain text with three live bits in it: @handles,
// #hashtags and links. Everything that renders or reads a peel body goes through
// here, so the link the reader taps and the notification the database wrote agree.
//
// The handle pattern is deliberately the same as the notify_on_peel() trigger's
// `@([a-z0-9_]{3,20})` over `lower(title)`: a GitHub login is case-insensitive,
// so `@Bob` is a mention of bob and both the trigger and this agree on that.
// `handle` is that lower-cased name; `value` stays exactly what the author
// typed. The one place this is stricter is the boundary rule below -- the
// trigger's left boundary is `[^a-z0-9_]`, so it would read "café@ada" as a
// mention while this renders it as an address. Erring towards rendering less is
// the safe direction (a stray notification, never a wrong link). A url is the
// same story from the other end: `https://x.com/@bob` is one link here and the
// trigger still counts it as a mention of bob, so bob's bell rings for a peel
// whose text never showed his name. A stray notification again, and the reader
// gets the link they can see rather than a handle buried in an address.

export type Token = {
  type: "text" | "mention" | "hashtag" | "link";
  /** The exact source text, sigil included. `value.slice(1)` is what was typed. */
  value: string;
  /** Mentions only: the handle in lower case, i.e. the profile to link to. */
  handle?: string;
};

/**
 * A sigil only counts at the start of a word: `ada@bobmail` and `C#sharp` are
 * ordinary text. `\p{L}\p{N}_` rather than `\w` so accented words glue too. A
 * url goes first so that the `@` and `#` inside one are part of the address
 * rather than a mention nobody typed.
 */
const TOKEN =
  /(?<![\p{L}\p{N}_])(?:https?:\/\/[^\s<>"'`]+|@[A-Za-z0-9_]{3,20}|#[\p{L}\p{N}_]{1,50})/gu;

/** Punctuation that ends a sentence rather than an address. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "]", "}", "'", '"', ")"]);

/**
 * A url without the punctuation the sentence around it put there:
 * "see https://ada.dev/notes." links the notes, not the full stop.
 *
 * A closing bracket is the interesting one, because a url is allowed to contain
 * them -- Wikipedia is full of `/wiki/Kochi_(India)`. So a `)` is kept when what
 * comes before it has an unclosed `(`, and dropped when it does not, which is
 * what makes "(see https://ada.dev/a)" and ".../Kochi_(India))" both come out right.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING.has(url[end - 1])) {
    if (url[end - 1] === ")") {
      const before = url.slice(0, end - 1);
      const opens = before.split("(").length;
      const closes = before.split(")").length;
      if (opens > closes) break;
    }
    end--;
  }
  return url.slice(0, end);
}

/**
 * Split a peel body into text / mention / hashtag / link runs, in order. Joining every
 * `value` back together reproduces the input exactly, so a renderer can walk the
 * list and never lose a character. Empty input gives an empty list.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    // A url match can be longer than the url: the punctuation trimmed off the
    // end is the sentence's, so it goes back as text and `at` stops short of
    // where the regex did. Nothing is lost -- what is trimmed is punctuation,
    // which neither a mention nor a hashtag can start with.
    const sigil = match[0].startsWith("@") || match[0].startsWith("#");
    const value = sigil ? match[0] : trimTrailing(match[0]);
    if (match.index > at) tokens.push({ type: "text", value: text.slice(at, match.index) });
    tokens.push(
      value.startsWith("@")
        ? { type: "mention", value, handle: value.slice(1).toLowerCase() }
        : value.startsWith("#")
          ? { type: "hashtag", value }
          : // "https://." is a scheme and a full stop; there is no address left
            // to link once the sentence's punctuation is off it.
            /^https?:\/\/[^/]/.test(value)
            ? { type: "link", value }
            : { type: "text", value },
    );
    at = match.index + value.length;
  }
  if (at < text.length) tokens.push({ type: "text", value: text.slice(at) });
  return tokens;
}

/** The handles a peel mentions, lower-cased and without the `@`, in order, each one once. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenize(text)) {
    if (token.handle) seen.add(token.handle);
  }
  return [...seen];
}
