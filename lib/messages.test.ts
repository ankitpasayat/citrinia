// Spec: a message is 1 to 2000 characters after trimming. A conversation row is
// the same row for both people in it, so every question about it takes the
// viewer: who the other person is, when this viewer last opened it, whether
// something is waiting for them, and whether it is a request -- which it only
// ever is for the person who did NOT start it. The badge counts accepted
// conversations with something waiting; requests stay off it until accepted.
import test from "node:test";
import assert from "node:assert/strict";
import type { Conversation } from "./messages.ts";
import {
  MAX_BODY,
  byNewest,
  isRequest,
  isUnread,
  otherId,
  pair,
  parseBody,
  readAt,
  remainingBody,
  split,
  unreadCount,
} from "./messages.ts";

const ADA = "00000000-0000-0000-0000-0000000000ad";
const BOB = "00000000-0000-0000-0000-0000000000b0";
const CAL = "00000000-0000-0000-0000-0000000000ca";

/** Ada is always `a` and Bob always `b` unless the test says otherwise. */
function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    a: ADA,
    b: BOB,
    started_by: ADA,
    accepted_at: "2026-09-01T10:00:00+00:00",
    last_message_at: "2026-09-01T12:00:00+00:00",
    last_sender_id: ADA,
    last_preview: "hello",
    a_read_at: null,
    b_read_at: null,
    ...over,
  };
}

//------------------------------------------------------------------------------
// The body
//------------------------------------------------------------------------------

test("the ceiling is the one the messages_body_length check enforces", () => {
  assert.equal(MAX_BODY, 2000);
});

test("a message is trimmed", () => {
  assert.deepEqual(parseBody("  hello  "), { body: "hello" });
});

test("nothing, or only spaces, is not a message", () => {
  assert.deepEqual(parseBody(""), { error: "Write something first." });
  assert.deepEqual(parseBody("   \n "), { error: "Write something first." });
  assert.deepEqual(parseBody(undefined), { error: "Write something first." });
  assert.deepEqual(parseBody(42), { error: "Write something first." });
});

test("2000 characters is allowed and 2001 is not", () => {
  assert.deepEqual(parseBody("x".repeat(2000)), { body: "x".repeat(2000) });
  const over = parseBody("x".repeat(2001));
  assert.ok("error" in over && over.error.startsWith("That's 1 over."));
});

test("characters are counted the way Postgres counts them", () => {
  // Two code points, four UTF-16 units: char_length() in Postgres says 2, so a
  // body of 1000 of these is 2000 characters and has to be allowed.
  const pair = "👩🔬";
  assert.equal(remainingBody(pair), MAX_BODY - 2);
  assert.ok("body" in parseBody(pair.repeat(1000)));
});

//------------------------------------------------------------------------------
// Which side you are
//------------------------------------------------------------------------------

test("the pair is stored smaller-first, whichever way round it is asked", () => {
  assert.deepEqual(pair(ADA, BOB), [ADA, BOB]);
  assert.deepEqual(pair(BOB, ADA), [ADA, BOB]);
  // Which is what makes the stored row findable from either side.
  const c = conversation();
  assert.deepEqual(pair(c.a, c.b), [c.a, c.b]);
});

test("the other person is whichever of the pair you are not", () => {
  const c = conversation();
  assert.equal(otherId(c, ADA), BOB);
  assert.equal(otherId(c, BOB), ADA);
});

test("your read stamp is your own side's", () => {
  const c = conversation({ a_read_at: "2026-09-01T11:00:00+00:00", b_read_at: "2026-09-02T09:00:00+00:00" });
  assert.equal(readAt(c, ADA), "2026-09-01T11:00:00+00:00");
  assert.equal(readAt(c, BOB), "2026-09-02T09:00:00+00:00");
});

//------------------------------------------------------------------------------
// Unread
//------------------------------------------------------------------------------

test("a conversation you have never opened is unread from its first message", () => {
  const c = conversation({ last_sender_id: ADA, b_read_at: null });
  assert.equal(isUnread(c, BOB), true);
});

test("your own message is never unread, however long ago you looked", () => {
  const c = conversation({ last_sender_id: ADA, a_read_at: null });
  assert.equal(isUnread(c, ADA), false);
});

test("opening it clears it, and the next message brings it back", () => {
  const opened = conversation({ last_sender_id: ADA, b_read_at: "2026-09-01T12:00:01+00:00" });
  assert.equal(isUnread(opened, BOB), false);

  const answered = { ...opened, last_message_at: "2026-09-01T12:00:02+00:00" };
  assert.equal(isUnread(answered, BOB), true);
});

test("a message that lands in the same second as the read stamp is not unread", () => {
  // The stamp is written after the message it acknowledges, so equal means seen.
  const c = conversation({ last_sender_id: ADA, b_read_at: "2026-09-01T12:00:00+00:00" });
  assert.equal(isUnread(c, BOB), false);
});

//------------------------------------------------------------------------------
// Requests
//------------------------------------------------------------------------------

test("an unaccepted conversation is a request to the person who did not start it", () => {
  const c = conversation({ accepted_at: null, started_by: ADA });
  assert.equal(isRequest(c, BOB), true);
  assert.equal(isRequest(c, ADA), false, "the sender is never shown that they are waiting");
});

test("once accepted it is a request to nobody", () => {
  const c = conversation({ accepted_at: "2026-09-02T00:00:00+00:00", started_by: ADA });
  assert.equal(isRequest(c, BOB), false);
});

test("requests are kept out of the inbox, for the recipient only", () => {
  const mine = conversation({ id: "mine", accepted_at: null, started_by: ADA });
  const theirs = conversation({ id: "theirs", accepted_at: null, started_by: BOB, a: ADA, b: BOB });
  const done = conversation({ id: "done", accepted_at: "2026-09-02T00:00:00+00:00" });

  const forAda = split([mine, theirs, done], ADA);
  assert.deepEqual(
    forAda.inbox.map((c) => c.id),
    ["mine", "done"],
  );
  assert.deepEqual(
    forAda.requests.map((c) => c.id),
    ["theirs"],
  );
});

test("the badge counts what is waiting in the inbox, and never a request", () => {
  const waiting = conversation({ id: "waiting", last_sender_id: ADA, b_read_at: null });
  const read = conversation({
    id: "read",
    last_sender_id: ADA,
    b_read_at: "2026-09-09T00:00:00+00:00",
  });
  const request = conversation({ id: "request", accepted_at: null, started_by: ADA, b_read_at: null });

  assert.equal(unreadCount([waiting, read, request], BOB), 1);
  // Ada sent all three, so there is nothing waiting for her.
  assert.equal(unreadCount([waiting, read, request], ADA), 0);
});

test("a conversation you are not in is nobody's business, but does not crash the count", () => {
  const c = conversation({ a: ADA, b: BOB, last_sender_id: ADA });
  // RLS never hands one of these over; the rule still has to answer sensibly.
  assert.equal(isUnread(c, CAL), true);
  assert.equal(otherId(c, CAL), ADA);
});

//------------------------------------------------------------------------------
// Order
//------------------------------------------------------------------------------

test("the list is newest first", () => {
  const old = conversation({ id: "old", last_message_at: "2026-09-01T00:00:00+00:00" });
  const mid = conversation({ id: "mid", last_message_at: "2026-09-05T00:00:00+00:00" });
  const now = conversation({ id: "now", last_message_at: "2026-09-09T00:00:00+00:00" });
  assert.deepEqual(
    [old, now, mid].sort(byNewest).map((c) => c.id),
    ["now", "mid", "old"],
  );
});
