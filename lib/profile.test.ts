// Spec: a profile has a name of 1 to 50 characters and a bio of 0 to 160,
// both trimmed and counted as Unicode code points. Runs of blank lines in the
// bio collapse to at most one blank line; anything shorter is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_NAME, MAX_BIO, parseProfile } from "./profile.ts";

/** Unwraps a result the spec says must be valid, so tests can read .bio directly. */
function ok(result: ReturnType<typeof parseProfile>): { name: string; bio: string } {
  if ("error" in result) assert.fail(`expected a valid profile, got: ${result.error}`);
  return result;
}

test("limits match the database constraints", () => {
  assert.equal(MAX_NAME, 50);
  assert.equal(MAX_BIO, 160);
});

test("accepts a name and bio, trimming both", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "counts things" }), {
    name: "Ada",
    bio: "counts things",
  });
  assert.deepEqual(parseProfile({ name: "  Ada  ", bio: "\n  hi  \n" }), {
    name: "Ada",
    bio: "hi",
  });
});

test("bio is optional and defaults to empty", () => {
  assert.deepEqual(parseProfile({ name: "Ada" }), { name: "Ada", bio: "" });
  assert.deepEqual(parseProfile({ name: "Ada", bio: null }), { name: "Ada", bio: "" });
  assert.deepEqual(parseProfile({ name: "Ada", bio: "   " }), { name: "Ada", bio: "" });
  assert.deepEqual(parseProfile({ name: "Ada", bio: 7 }), { name: "Ada", bio: "" });
});

test("name is required", () => {
  for (const name of ["", "   ", " \n ", null, undefined, 42]) {
    const got = parseProfile({ name, bio: "" });
    assert.ok("error" in got, `expected ${JSON.stringify(name)} to be rejected`);
  }
});

test("name boundary is 50 code points", () => {
  assert.deepEqual(parseProfile({ name: "a".repeat(50) }), { name: "a".repeat(50), bio: "" });
  assert.deepEqual(parseProfile({ name: "🍊".repeat(50) }), { name: "🍊".repeat(50), bio: "" });

  const over = parseProfile({ name: "a".repeat(51) });
  assert.ok("error" in over, "51 characters must be rejected");
  assert.match(over.error, /\b1\b/);

  const emoji = parseProfile({ name: "🍊".repeat(51) });
  assert.ok("error" in emoji, "51 emoji must be rejected");
});

test("bio boundary is 160 code points", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "b".repeat(160) }), {
    name: "Ada",
    bio: "b".repeat(160),
  });
  assert.deepEqual(parseProfile({ name: "Ada", bio: "🍊".repeat(160) }), {
    name: "Ada",
    bio: "🍊".repeat(160),
  });

  const over = parseProfile({ name: "Ada", bio: "b".repeat(161) });
  assert.ok("error" in over, "161 characters must be rejected");
  assert.match(over.error, /\b1\b/);
});

test("a bio of exactly zero characters is fine", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "" }), { name: "Ada", bio: "" });
});

test("single newlines and one blank line survive; longer runs collapse", () => {
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\ntwo" })).bio, "one\ntwo");
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\n\ntwo" })).bio, "one\n\ntwo");
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\n\n\ntwo" })).bio, "one\n\ntwo");
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\n\n\n\n\n\ntwo" })).bio, "one\n\ntwo");
  // Whitespace-only lines are still blank lines.
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\n \n\t\ntwo" })).bio, "one\n\ntwo");
  // CRLF normalises to LF so the stored bio does not depend on the browser.
  assert.deepEqual(ok(parseProfile({ name: "Ada", bio: "one\r\ntwo" })).bio, "one\ntwo");
});

test("newlines collapse before the length is checked", () => {
  // 160 real characters plus 5 surplus newlines is 160 once collapsed.
  const bio = `${"a".repeat(80)}\n\n\n\n\n\n\n${"b".repeat(78)}`;
  const got = parseProfile({ name: "Ada", bio });
  assert.deepEqual(got, { name: "Ada", bio: `${"a".repeat(80)}\n\n${"b".repeat(78)}` });
});
