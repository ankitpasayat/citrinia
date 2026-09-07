// The rules a conversation is read by. Pure, and shared by everything that asks:
// the list, the requests tab, the badge on the bar and the conversation screen.
//
// Which side of a conversation you are is not stored -- `a` and `b` are just the
// pair in a fixed order, so the same row means different things to the two
// people in it. Every question below therefore takes the viewer, and nothing in
// the app is allowed to reach for `a_read_at` on its own.
//
// The unread rule in particular lives HERE and only here, rather than half in
// SQL: the badge counts what the list marks, so they cannot disagree about what
// unread means.
import { countChars } from "./peel.ts";

/** The same ceiling as the messages_body_length check. */
export const MAX_BODY = 2000;

export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];

export function remainingBody(text: string): number {
  return MAX_BODY - countChars(text);
}

/** What the composer sends, or one short line for the person typing. */
export function parseBody(raw: unknown): { body: string } | { error: string } {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length === 0) return { error: "Write something first." };
  const over = countChars(body) - MAX_BODY;
  if (over > 0) return { error: `That's ${over} over. A message is 1 to ${MAX_BODY} characters.` };
  return { body };
}

/**
 * The pair in the order the table stores it. `a < b` is a check constraint, so
 * finding the conversation between two people means asking for exactly this
 * pair -- and Postgres compares uuids by their bytes, which for the lower-case
 * hex form PostgREST returns is the same order JavaScript compares the strings
 * in. (Upper case would not be; nothing here produces any.)
 */
export function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** The person on the other side of it. */
export function otherId(c: Conversation, viewerId: string): string {
  return c.a === viewerId ? c.b : c.a;
}

/** When the viewer last opened it, or null if they never have. */
export function readAt(c: Conversation, viewerId: string): string | null {
  return c.a === viewerId ? c.a_read_at : c.b_read_at;
}

/**
 * Something waiting for the viewer: the newest message is not theirs, and it
 * landed after they last opened it. A conversation that has never been opened is
 * unread from its first message, which is why `null` reads as "before anything".
 */
export function isUnread(c: Conversation, viewerId: string): boolean {
  if (c.last_sender_id === viewerId) return false;
  const seen = readAt(c, viewerId);
  return seen === null || c.last_message_at > seen;
}

/**
 * A request is only ever a request to the person who did not start it. The
 * sender sees an ordinary conversation and is never told it is waiting -- that
 * is the whole design, and the reason `accepted_at` alone is not the answer.
 */
export function isRequest(c: Conversation, viewerId: string): boolean {
  return c.accepted_at === null && c.started_by !== viewerId;
}

/**
 * The two lists a person has. Requests are kept out of the inbox and off the
 * badge until they are accepted; both keep the newest-first order they arrived
 * in.
 */
export function split(
  conversations: Conversation[],
  viewerId: string,
): { inbox: Conversation[]; requests: Conversation[] } {
  const inbox: Conversation[] = [];
  const requests: Conversation[] = [];
  for (const c of conversations) (isRequest(c, viewerId) ? requests : inbox).push(c);
  return { inbox, requests };
}

/** What the badge shows: conversations with something in them for the viewer. */
export function unreadCount(conversations: Conversation[], viewerId: string): number {
  return split(conversations, viewerId).inbox.filter((c) => isUnread(c, viewerId)).length;
}

/** Timestamps come back from PostgREST as ISO strings; this sorts them newest first. */
export function byNewest(x: Conversation, y: Conversation): number {
  return x.last_message_at < y.last_message_at ? 1 : x.last_message_at > y.last_message_at ? -1 : 0;
}
