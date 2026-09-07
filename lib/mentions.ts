// The @ list in the composer: working out which handle somebody is in the
// middle of typing, and what the text looks like once they pick one.
//
// The boundary rule is lib/text.ts's, deliberately: the list must only offer to
// complete something that would actually render as a mention, so `ada@bobmail`
// gets no dropdown -- an address is not a half-typed handle. It is also
// narrower at the front, needing two characters before it says anything, which
// is what keeps `@a` from asking the database about a third of the people on it.
//
// Nothing here decides who gets notified. That is notify_on_peel()'s job, off
// the text that was posted, so a handle typed by hand and a handle picked from
// this list are the same handle by the time it matters.

/** As many characters as a handle can have; `@` plus 3 to 20 is what the trigger reads. */
const MAX_HANDLE = 20;

/**
 * The `@handle` being typed immediately before `caret`, or null when the caret
 * is not in one. `start` is the index of the `@` itself, so the caller can
 * replace exactly what was typed.
 *
 * Two characters is the floor rather than one: it is the difference between a
 * useful list and every profile on the site.
 */
export function mentionAt(text: string, caret: number): { term: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?<![\p{L}\p{N}_])@([A-Za-z0-9_]{2,20})$/u.exec(before);
  if (!match) return null;
  return { term: match[1], start: caret - match[1].length - 1 };
}

/**
 * The text after picking `handle` for the term that starts at `start`. The
 * handle is followed by a space, because the next thing typed is a word rather
 * than more of the handle, and without it the sentence has to be un-stuck by
 * hand -- unless the sentence already has one there, in which case completing a
 * handle in the middle of it must not push a second space in.
 */
export function completeMention(
  text: string,
  start: number,
  caret: number,
  handle: string,
): { text: string; caret: number } {
  const spaced = /^\s/.test(text.slice(caret));
  const inserted = `@${handle}${spaced ? "" : " "}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    // Past the space either way: the caret belongs where the next word goes.
    caret: start + inserted.length + (spaced ? 1 : 0),
  };
}

/** Whether a term is one the profiles query can be given as a pattern, unescaped. */
export function isHandleTerm(term: string): boolean {
  return new RegExp(`^[A-Za-z0-9_]{2,${MAX_HANDLE}}$`).test(term);
}
