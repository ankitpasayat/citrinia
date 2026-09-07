// Spec: the composer posts `items`, a JSON array of `{ title, media }` in the
// order they go up. One item is an ordinary peel. Every title obeys the same 1
// to 280 rule a single peel does and every attachment the same media rules, and
// when there is more than one box the message says which box it is about. A
// thread is 1 to 25 peels, because 25 is how deep peel_ancestors() walks.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_THREAD, parseThread } from "./thread.ts";

const box = (title: string, media?: unknown) =>
  JSON.stringify([media === undefined ? { title } : { title, media }]);

const picture = { kind: "image", url: "https://ada.dev/a.png", alt: "a lemon" };

test("MAX_THREAD is peel_ancestors()'s depth", () => {
  assert.equal(MAX_THREAD, 25);
});

test("one box is an ordinary peel", () => {
  const parsed = parseThread(box("  hello  "));
  assert.deepEqual(parsed, [{ title: "hello", media: [] }]);
});

test("the boxes keep the order they were written in", () => {
  const parsed = parseThread(JSON.stringify([{ title: "one" }, { title: "two" }, { title: "three" }]));
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(
    parsed.map((item) => item.title),
    ["one", "two", "three"],
  );
});

test("media rides on the box it was attached to", () => {
  const parsed = parseThread(JSON.stringify([{ title: "one", media: [picture] }, { title: "two" }]));
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].media.length, 1);
  assert.equal(parsed[0].media[0].url, "https://ada.dev/a.png");
  assert.deepEqual(parsed[1].media, []);
});

test("nothing at all is 'write something first', however it is spelled", () => {
  const empty = { error: "Write something first." };
  assert.deepEqual(parseThread(undefined), empty);
  assert.deepEqual(parseThread(null), empty);
  assert.deepEqual(parseThread(""), empty);
  assert.deepEqual(parseThread("   "), empty);
  assert.deepEqual(parseThread("[]"), empty);
  // A single box with nothing in it is the same thing said in JSON.
  assert.deepEqual(parseThread(box("   ")), empty);
});

test("a bad title is refused, and every peel obeys the same length rule", () => {
  assert.deepEqual(parseThread(box("x".repeat(281))), {
    error: "That's 1 over. A peel is 1 to 280 characters.",
  });
  assert.ok(Array.isArray(parseThread(box("x".repeat(280)))));
  // The rule does not go soft further down the thread.
  assert.deepEqual(parseThread(JSON.stringify([{ title: "one" }, { title: "x".repeat(281) }])), {
    error: "Peel 2: that's 1 over. A peel is 1 to 280 characters.",
  });
});

test("the message names the box once there is more than one", () => {
  assert.deepEqual(parseThread(JSON.stringify([{ title: "one" }, { title: "  " }])), {
    error: "Peel 2: write something first.",
  });
  assert.deepEqual(parseThread(JSON.stringify([{ title: "one" }, { title: "two" }, { title: "" }])), {
    error: "Peel 3: write something first.",
  });
});

test("a peel's media is checked the same way whichever box it is in", () => {
  // An image with no description is refused by lib/media.ts; a thread is not a
  // way round it.
  assert.deepEqual(parseThread(JSON.stringify([{ title: "one" }, { title: "two", media: [{ ...picture, alt: "" }] }])), {
    error: "Peel 2: every image needs alt text.",
  });
  assert.deepEqual(parseThread(box("one", [{ ...picture, url: "http://evil.example/x.png" }])), {
    error: "Media needs an https link.",
  });
});

test("a thread is 1 to 25 peels", () => {
  const many = (n: number) => JSON.stringify(Array.from({ length: n }, (_, at) => ({ title: `peel ${at}` })));
  const twentyFive = parseThread(many(25));
  assert.ok(Array.isArray(twentyFive));
  assert.equal(twentyFive.length, 25);
  assert.deepEqual(parseThread(many(26)), { error: "A thread is up to 25 peels." });
});

test("anything that is not a list of boxes is unreadable, not a crash", () => {
  const unreadable = { error: "Couldn't read that peel. Try again." };
  assert.deepEqual(parseThread("{"), unreadable);
  assert.deepEqual(parseThread('"just a string"'), unreadable);
  assert.deepEqual(parseThread("42"), unreadable);
  assert.deepEqual(parseThread('{"title":"not in a list"}'), unreadable);
  assert.deepEqual(parseThread('["one"]'), unreadable);
  assert.deepEqual(parseThread("[null]"), unreadable);
  assert.deepEqual(parseThread("[[]]"), unreadable);
  // Not a string at all: the form field was never set.
  assert.deepEqual(parseThread(42), { error: "Write something first." });
});
