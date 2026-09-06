// Peel text. A peel is plain text with two live bits in it: @handles and
// #hashtags. Everything that renders or reads a peel body goes through here, so
// the link the reader taps and the notification the database wrote agree.
//
// The handle pattern is deliberately the same as the notify_on_peel() trigger's
// `@([a-z0-9_]{3,20})` over `lower(title)`: a GitHub login is case-insensitive,
// so `@Bob` is a mention of bob and both the trigger and this agree on that.
// `handle` is that lower-cased name; `value` stays exactly what the author
// typed. The one place this is stricter is the boundary rule below -- the
// trigger's left boundary is `[^a-z0-9_]`, so it would read "café@ada" as a
// mention while this renders it as an address. Erring towards rendering less is
// the safe direction (a stray notification, never a wrong link).

export type Token = {
  type: "text" | "mention" | "hashtag";
  /** The exact source text, sigil included. `value.slice(1)` is what was typed. */
  value: string;
  /** Mentions only: the handle in lower case, i.e. the profile to link to. */
  handle?: string;
};

/**
 * A sigil only counts at the start of a word: `ada@bobmail` and `C#sharp` are
 * ordinary text. `\p{L}\p{N}_` rather than `\w` so accented words glue too.
 */
const TOKEN = /(?<![\p{L}\p{N}_])(?:@[A-Za-z0-9_]{3,20}|#[\p{L}\p{N}_]{1,50})/gu;

/**
 * Split a peel body into text / mention / hashtag runs, in order. Joining every
 * `value` back together reproduces the input exactly, so a renderer can walk the
 * list and never lose a character. Empty input gives an empty list.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) tokens.push({ type: "text", value: text.slice(at, match.index) });
    tokens.push(
      match[0].startsWith("@")
        ? { type: "mention", value: match[0], handle: match[0].slice(1).toLowerCase() }
        : { type: "hashtag", value: match[0] },
    );
    at = match.index + match[0].length;
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
