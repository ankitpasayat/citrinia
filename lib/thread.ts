// What the composer posts. A thread is one or more peels that go up as a chain,
// each a reply to the one before, and a lone peel is a thread of one -- so the
// composer has one wire shape and the server one gate, rather than a special
// case for the common length.
//
// This is the gate between the composer's `items` field and add_thread(): every
// title goes through parseTitle and every attachment through parseMedia, so a
// thread cannot smuggle past a rule a single peel obeys. The database says the
// same things again (the title check, the media constraints, the 25 ceiling) --
// this is here so the person composing hears it in words rather than in a
// constraint name, and hears which peel it was about.
import { parseMedia } from "./media.ts";
import { parseTitle } from "./peel.ts";

/**
 * The most peels one "Peel all" can post. Chosen to be peel_ancestors()'s
 * default depth, so even the last peel of the longest thread draws its whole
 * chain on the peel page.
 */
export const MAX_THREAD = 25;

/** One box of the composer, ready to insert. */
export type ThreadItem = { title: string; media: PeelMedia[] };

/**
 * Parse the composer's `items` field: a JSON array of `{ title, media }`, in the
 * order they will be posted. Returns the items or one short message naming the
 * peel that is wrong -- a thread of eight boxes with a bad one in it is no help
 * at all if the message does not say which.
 */
export function parseThread(raw: unknown): ThreadItem[] | { error: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { error: "Write something first." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Couldn't read that peel. Try again." };
  }
  if (!Array.isArray(parsed)) return { error: "Couldn't read that peel. Try again." };
  if (parsed.length === 0) return { error: "Write something first." };
  if (parsed.length > MAX_THREAD) return { error: `A thread is up to ${MAX_THREAD} peels.` };

  const items: ThreadItem[] = [];
  for (const [at, one] of parsed.entries()) {
    if (typeof one !== "object" || one === null || Array.isArray(one)) {
      return { error: "Couldn't read that peel. Try again." };
    }
    const box = one as Record<string, unknown>;

    const title = parseTitle(box.title);
    if ("error" in title) return { error: naming(title.error, at, parsed.length) };

    const media = parseMedia(box.media);
    if (!Array.isArray(media)) return { error: naming(media.error, at, parsed.length) };

    items.push({ title: title.title, media });
  }
  return items;
}

/**
 * The same message, but saying which box it is about once there is more than
 * one. "Write something first." alone; "Peel 3: write something first." in a
 * thread -- the sentence keeps its shape, it just gains an address.
 */
function naming(message: string, at: number, total: number): string {
  if (total === 1) return message;
  return `Peel ${at + 1}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}
