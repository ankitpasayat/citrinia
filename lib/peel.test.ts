// Spec: a peel is 1 to 280 characters after trimming, counted as Unicode code
// points so an emoji costs 1 -- the same count Postgres char_length() applies in
// the peels_title_length constraint.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TITLE, countChars, remaining, parseTitle } from "./peel.ts";

const EMPTY_ERROR = "Write something first.";

test("MAX_TITLE matches the database constraint", () => {
  assert.equal(MAX_TITLE, 280);
});

test("countChars counts code points, not UTF-16 units", () => {
  assert.equal(countChars(""), 0);
  assert.equal(countChars("abc"), 3);
  assert.equal(countChars("🍊"), 1);
  assert.equal(countChars("a🍊b"), 3);
  // A regional-indicator pair is two code points, and Postgres agrees.
  assert.equal(countChars("🇬🇧"), 2);
});

test("remaining counts the raw text, not the trimmed text", () => {
  assert.equal(remaining(""), 280);
  assert.equal(remaining("hi"), 278);
  assert.equal(remaining("  hi  "), 274);
  assert.equal(remaining("🍊".repeat(280)), 0);
  assert.equal(remaining("a".repeat(281)), -1);
});

test("parseTitle accepts 1 to 280 characters and trims", () => {
  assert.deepEqual(parseTitle("a"), { title: "a" });
  assert.deepEqual(parseTitle("  hi  "), { title: "hi" });
  assert.deepEqual(parseTitle("a".repeat(280)), { title: "a".repeat(280) });
  // Trimming happens before counting: padding does not push it over.
  assert.deepEqual(parseTitle(`  ${"a".repeat(280)}  `), { title: "a".repeat(280) });
  assert.deepEqual(parseTitle("🍊".repeat(280)), { title: "🍊".repeat(280) });
});

test("parseTitle rejects empty and whitespace-only input", () => {
  assert.deepEqual(parseTitle(""), { error: EMPTY_ERROR });
  assert.deepEqual(parseTitle("   "), { error: EMPTY_ERROR });
  assert.deepEqual(parseTitle(" \n\t "), { error: EMPTY_ERROR });
});

test("parseTitle treats non-string input as empty", () => {
  assert.deepEqual(parseTitle(null), { error: EMPTY_ERROR });
  assert.deepEqual(parseTitle(undefined), { error: EMPTY_ERROR });
  assert.deepEqual(parseTitle(42), { error: EMPTY_ERROR });
  assert.deepEqual(parseTitle(new File([], "x.png")), { error: EMPTY_ERROR });
});

test("parseTitle rejects over-long input and says how far over", () => {
  const one = parseTitle("a".repeat(281));
  assert.ok("error" in one, "281 characters must be rejected");
  assert.match(one.error, /\b1\b/);

  const twenty = parseTitle("a".repeat(300));
  assert.ok("error" in twenty, "300 characters must be rejected");
  assert.match(twenty.error, /\b20\b/);

  // Emoji count as one, so 281 of them is exactly 1 over.
  const emoji = parseTitle("🍊".repeat(281));
  assert.ok("error" in emoji, "281 emoji must be rejected");
  assert.match(emoji.error, /\b1\b/);
});
