// Spec: a profile has a name of 1 to 50 characters, a bio of 0 to 160 and a
// location of 0 to 30, all trimmed and counted as Unicode code points. Runs of
// blank lines in the bio collapse to at most one blank line; anything shorter is
// left alone. The link is stored as an https url or nothing at all: a bare host
// gets the scheme, http is upgraded, and every other scheme is refused, because
// what comes back out of this goes into an href other people click.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BIO,
  MAX_HANDLE,
  MAX_LOCATION,
  MAX_NAME,
  MAX_WEBSITE,
  MIN_HANDLE,
  displayWebsite,
  parseHandle,
  parseProfile,
  parseWebsite,
} from "./profile.ts";
import { tokenize } from "./text.ts";

type Parsed = { name: string; bio: string; location: string; website: string };

/** The profile the spec expects: fields a test does not mention are empty. */
function parsed(fields: { name: string } & Partial<Parsed>): Parsed {
  return { bio: "", location: "", website: "", ...fields };
}

/** Unwraps a result the spec says must be valid, so tests can read .bio directly. */
function ok(result: ReturnType<typeof parseProfile>): Parsed {
  if ("error" in result) assert.fail(`expected a valid profile, got: ${result.error}`);
  return result;
}

/** Unwraps a handle the spec says must be valid. */
function okHandle(result: ReturnType<typeof parseHandle>): string {
  if ("error" in result) assert.fail(`expected a valid handle, got: ${result.error}`);
  return result.handle;
}

/** Unwraps a link the spec says must be valid. */
function link(raw: string): string {
  const got = parseWebsite(raw);
  if ("error" in got) assert.fail(`expected ${raw} to be a valid link, got: ${got.error}`);
  return got.website;
}

test("limits match the database constraints", () => {
  assert.equal(MAX_NAME, 50);
  assert.equal(MAX_BIO, 160);
  assert.equal(MAX_LOCATION, 30);
  assert.equal(MAX_WEBSITE, 100);
});

test("accepts a name and bio, trimming both", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "counts things" }), parsed({
    name: "Ada",
    bio: "counts things",
  }));
  assert.deepEqual(parseProfile({ name: "  Ada  ", bio: "\n  hi  \n" }), parsed({
    name: "Ada",
    bio: "hi",
  }));
});

test("bio is optional and defaults to empty", () => {
  assert.deepEqual(parseProfile({ name: "Ada" }), parsed({ name: "Ada" }));
  assert.deepEqual(parseProfile({ name: "Ada", bio: null }), parsed({ name: "Ada" }));
  assert.deepEqual(parseProfile({ name: "Ada", bio: "   " }), parsed({ name: "Ada" }));
  assert.deepEqual(parseProfile({ name: "Ada", bio: 7 }), parsed({ name: "Ada" }));
});

test("name is required", () => {
  for (const name of ["", "   ", " \n ", null, undefined, 42]) {
    const got = parseProfile({ name, bio: "" });
    assert.ok("error" in got, `expected ${JSON.stringify(name)} to be rejected`);
  }
});

test("name boundary is 50 code points", () => {
  assert.deepEqual(parseProfile({ name: "a".repeat(50) }), parsed({ name: "a".repeat(50) }));
  assert.deepEqual(parseProfile({ name: "🍊".repeat(50) }), parsed({ name: "🍊".repeat(50) }));

  const over = parseProfile({ name: "a".repeat(51) });
  assert.ok("error" in over, "51 characters must be rejected");
  assert.match(over.error, /\b1\b/);

  const emoji = parseProfile({ name: "🍊".repeat(51) });
  assert.ok("error" in emoji, "51 emoji must be rejected");
});

test("bio boundary is 160 code points", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "b".repeat(160) }), parsed({
    name: "Ada",
    bio: "b".repeat(160),
  }));
  assert.deepEqual(parseProfile({ name: "Ada", bio: "🍊".repeat(160) }), parsed({
    name: "Ada",
    bio: "🍊".repeat(160),
  }));

  const over = parseProfile({ name: "Ada", bio: "b".repeat(161) });
  assert.ok("error" in over, "161 characters must be rejected");
  assert.match(over.error, /\b1\b/);
});

test("a bio of exactly zero characters is fine", () => {
  assert.deepEqual(parseProfile({ name: "Ada", bio: "" }), parsed({ name: "Ada" }));
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
  assert.deepEqual(got, parsed({ name: "Ada", bio: `${"a".repeat(80)}\n\n${"b".repeat(78)}` }));
});

test("location is one trimmed line, optional, and capped at 30", () => {
  assert.equal(ok(parseProfile({ name: "Ada", location: "  London  " })).location, "London");
  // A pasted address arrives with its line breaks; a location sits inline.
  assert.equal(ok(parseProfile({ name: "Ada", location: "London\nEngland" })).location, "London England");
  assert.equal(ok(parseProfile({ name: "Ada", location: "a  \t b" })).location, "a b");

  for (const raw of [undefined, null, 42, "", "   "]) {
    assert.equal(ok(parseProfile({ name: "Ada", location: raw })).location, "");
  }

  assert.equal(ok(parseProfile({ name: "Ada", location: "x".repeat(30) })).location, "x".repeat(30));
  assert.equal(ok(parseProfile({ name: "Ada", location: "🍊".repeat(30) })).location, "🍊".repeat(30));
  const over = parseProfile({ name: "Ada", location: "x".repeat(31) });
  assert.ok("error" in over, "31 characters must be rejected");
});

test("a link with no scheme gets https, and http is upgraded to it", () => {
  assert.equal(link("ada.example"), "https://ada.example");
  assert.equal(link("www.ada.example"), "https://www.ada.example");
  assert.equal(link("http://ada.example"), "https://ada.example");
  assert.equal(link("https://ada.example"), "https://ada.example");
  assert.equal(link("  ada.example  "), "https://ada.example");
});

test("only http and https are storable, because this becomes an href", () => {
  for (const raw of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "ftp://ada.example",
    "file:///etc/passwd",
    // A digit after the colon is how a port is told from a scheme; neither of
    // these is a host with a port, and neither may sneak through as one.
    "javascript:1;alert(1)",
    "data:1234",
  ]) {
    const got = parseWebsite(raw);
    assert.ok("error" in got, `expected ${raw} to be refused`);
  }
});

test("a link cannot smuggle credentials in front of the host", () => {
  // The profile shows the host, so this would read as ada.example to a skimmer.
  for (const raw of ["https://ada.example@evil.example", "https://user:pw@evil.example"]) {
    const got = parseWebsite(raw);
    assert.ok("error" in got, `expected ${raw} to be refused`);
  }
});

test("something that is not a host is refused", () => {
  for (const raw of ["not a link", "localhost", "https://localhost", "https://", "..", "https://a."]) {
    const got = parseWebsite(raw);
    assert.ok("error" in got, `expected ${JSON.stringify(raw)} to be refused`);
  }
});

test("a link is stored the way a browser would resolve it", () => {
  // Host case and Unicode are the browser's business, not the reader's.
  assert.equal(link("https://ADA.Example"), "https://ada.example");
  assert.equal(link("münchen.de"), "https://xn--mnchen-3ya.de");
  // A bare host is a link, not a directory, so it keeps no trailing slash.
  assert.equal(link("https://ada.example/"), "https://ada.example");
  // A real path is part of the link and stays.
  assert.equal(link("ada.example/notes"), "https://ada.example/notes");
  assert.equal(link("ada.example:8443"), "https://ada.example:8443");
});

test("a link is empty when nothing was typed", () => {
  for (const raw of [undefined, null, 42, "", "   "]) {
    assert.deepEqual(parseWebsite(raw), { website: "" });
  }
  assert.equal(ok(parseProfile({ name: "Ada" })).website, "");
});

test("link boundary is 100 characters, counting the scheme the column stores", () => {
  const fits = `${"a".repeat(88)}.com`; // 92 + "https://" is exactly 100
  assert.equal(link(fits).length, 100);
  const over = parseWebsite(`${"a".repeat(89)}.com`);
  assert.ok("error" in over, "101 characters must be rejected");
});

test("a bad link fails the whole profile rather than being dropped", () => {
  const got = parseProfile({ name: "Ada", bio: "hi", website: "javascript:alert(1)" });
  assert.ok("error" in got, "a refused link must not save the rest silently");
});

test("a stored link is shown without its scheme or a trailing slash", () => {
  assert.equal(displayWebsite("https://ada.example"), "ada.example");
  assert.equal(displayWebsite("https://ada.example/notes"), "ada.example/notes");
  assert.equal(displayWebsite("https://ada.example/notes/"), "ada.example/notes");
  assert.equal(displayWebsite(""), "");
});

// Spec: a handle is 3 to 20 characters of [a-z0-9_], lower case, and that range
// is exactly what `@handle` matches in lib/text.ts — a handle outside it could
// never be mentioned. A typed "@" and any capitals are meant, not refused.
test("handle limits are the ones a mention can match", () => {
  assert.equal(MIN_HANDLE, 3);
  assert.equal(MAX_HANDLE, 20);
  // The mention token in lib/text.ts is @[A-Za-z0-9_]{3,20}; if that ever moves,
  // these move with it or handles stop being addressable.
  assert.deepEqual(tokenize("@ada_lovelace hi").map((t) => t.type), ["mention", "text"]);
  assert.deepEqual(okHandle(parseHandle("Ada_Lovelace")), "ada_lovelace");
});

test("a handle is lower-cased, and a typed @ is not part of it", () => {
  assert.equal(okHandle(parseHandle("ADA")), "ada");
  assert.equal(okHandle(parseHandle("@ada")), "ada");
  assert.equal(okHandle(parseHandle("  @Ada  ")), "ada");
  assert.equal(okHandle(parseHandle("@@ada")), "ada");
});

test("a handle that no mention could match is refused", () => {
  for (const raw of ["", "  ", "ab", "@ab", "a".repeat(21), "ada lovelace", "ada-lovelace", "adá", "ada!", null, 42]) {
    const got = parseHandle(raw);
    assert.ok("error" in got, `expected ${JSON.stringify(raw)} to be refused`);
  }
});

test("a handle at either boundary is fine", () => {
  assert.equal(okHandle(parseHandle("a".repeat(3))), "aaa");
  assert.equal(okHandle(parseHandle("a".repeat(20))), "a".repeat(20));
  assert.equal(okHandle(parseHandle("___")), "___");
  assert.equal(okHandle(parseHandle("123")), "123");
});
