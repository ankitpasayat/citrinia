// Spec: the composer offers a list of people after `@` and two characters, and
// only where a mention could actually be -- the same word-boundary rule
// lib/text.ts renders by, so the list never offers to complete something that
// would come out as plain text. Picking somebody replaces exactly what was
// typed with `@handle ` and leaves the caret after the space.
import test from "node:test";
import assert from "node:assert/strict";
import { completeMention, isHandleTerm, mentionAt } from "./mentions.ts";
import { tokenize } from "./text.ts";

/** The caret at the end of what has been typed, which is the normal case. */
const typing = (text: string) => mentionAt(text, text.length);

test("two characters after @ opens the list, one does not", () => {
  assert.equal(typing("@"), null);
  assert.equal(typing("@b"), null);
  assert.deepEqual(typing("@bo"), { term: "bo", start: 0 });
  assert.deepEqual(typing("hello @bo"), { term: "bo", start: 6 });
});

test("start points at the @ itself, so the whole thing can be replaced", () => {
  const text = "morning @ad";
  const found = typing(text);
  assert.ok(found);
  assert.equal(text.slice(found.start), "@ad");
});

test("only where a mention could be: the same boundary lib/text.ts renders by", () => {
  // An address is not a half-typed handle.
  assert.equal(typing("ada@bob"), null);
  assert.equal(typing("café@bob"), null);
  // A handle after punctuation or a bracket is still a handle.
  assert.deepEqual(typing("(@bob"), { term: "bob", start: 1 });
  assert.deepEqual(typing("hi,@bob"), { term: "bob", start: 3 });
  // And what it offers to complete really does tokenize as a mention.
  assert.equal(tokenize("hi,@bob").find((t) => t.type === "mention")?.handle, "bob");
  assert.equal(
    tokenize("ada@bob").some((t) => t.type === "mention"),
    false,
  );
});

test("the list closes once the handle can no longer grow", () => {
  // A space ends it.
  assert.equal(typing("@bob "), null);
  // So does a character a handle cannot contain.
  assert.equal(typing("@bob!"), null);
  assert.equal(typing("@bob-smith"), null);
  // 20 characters is a whole handle; 21 is not one at all.
  assert.ok(typing(`@${"a".repeat(20)}`));
  assert.equal(typing(`@${"a".repeat(21)}`), null);
});

test("only the handle the caret is actually in", () => {
  const text = "@ada and @bob";
  // At the end: the second one.
  assert.deepEqual(mentionAt(text, text.length), { term: "bob", start: 9 });
  // Parked inside the first one: the first one, cut where the caret is.
  assert.deepEqual(mentionAt(text, 4), { term: "ada", start: 0 });
  // In the space between them: neither.
  assert.equal(mentionAt(text, 8), null);
  // Before anything was typed at all.
  assert.equal(mentionAt("", 0), null);
});

test("picking somebody replaces what was typed and leaves room for the next word", () => {
  const text = "morning @bo";
  const found = mentionAt(text, text.length);
  assert.ok(found);
  const done = completeMention(text, found.start, text.length, "bob");
  assert.equal(done.text, "morning @bob ");
  assert.equal(done.caret, done.text.length);
  // The completed handle is a real mention, not just text that looks like one.
  assert.equal(tokenize(done.text).find((t) => t.type === "mention")?.handle, "bob");
});

test("picking in the middle of a sentence keeps the rest of it", () => {
  const text = "tell @ad about the marmalade";
  const caret = "tell @ad".length;
  const found = mentionAt(text, caret);
  assert.ok(found);
  const done = completeMention(text, found.start, caret, "ada");
  assert.equal(done.text, "tell @ada about the marmalade");
  assert.equal(done.caret, "tell @ada ".length);
});

test("a term the list would search is always safe to hand to a pattern", () => {
  assert.ok(isHandleTerm("bo"));
  assert.ok(isHandleTerm("bob_smith"));
  assert.ok(!isHandleTerm("b"));
  assert.ok(!isHandleTerm(""));
  assert.ok(!isHandleTerm("a".repeat(21)));
  // Nothing that could mean something to a regex ever gets that far.
  for (const nasty of [".*", "a|b", "a(b", "a\\b", "a%b", "a b", "ünicode"]) {
    assert.ok(!isHandleTerm(nasty), nasty);
  }
  // Whatever mentionAt hands back is one of these, by construction.
  const found = typing("hello @bob_smith");
  assert.ok(found && isHandleTerm(found.term));
});
