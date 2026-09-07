// Spec: a peel's body is plain text with three live bits in it -- @handles,
// which notify somebody and link to a profile, #hashtags, which link to a
// search, and links, which open the page they name. tokenize() splits the text
// into those runs so the renderer never has to parse anything itself, and
// extractMentions() answers "who does this peel notify".
//
// A link is http(s) followed by a run of non-space, minus whatever punctuation
// at the end of it belongs to the sentence rather than the address -- with the
// one exception that a closing bracket is part of the url when the url opened
// one, because half of Wikipedia is spelled that way.
//
// A handle is @ followed by 3 to 20 of [a-z0-9_], in any case: usernames come
// from GitHub logins, which are case-insensitive, so "@Bob" is a mention of bob
// exactly as the notify_on_peel() trigger reads it (it lower-cases the peel
// before matching). The token keeps what the author typed; `handle` is the
// lower-case name to link to. A hashtag is # followed by 1 to 50 letters, digits
// or underscores, in any script. Neither counts when the sigil is glued to the
// end of a word, so an email address stays an email address.
import test from "node:test";
import assert from "node:assert/strict";
import { extractMentions, tokenize } from "./text.ts";

/** The tokens as "type:value", which is what the assertions below read like. */
function shape(text: string): string[] {
  return tokenize(text).map((t) => `${t.type}:${t.value}`);
}

/** The handle every mention token carries, in order. */
function handles(text: string): (string | undefined)[] {
  return tokenize(text)
    .filter((t) => t.type === "mention")
    .map((t) => t.handle);
}

test("plain text is one text token, and empty text is no tokens", () => {
  assert.deepEqual(shape("how are you peeling?"), ["text:how are you peeling?"]);
  assert.deepEqual(tokenize(""), []);
});

test("a handle on its own is a mention, sigil included in the value", () => {
  assert.deepEqual(shape("@ada"), ["mention:@ada"]);
  assert.deepEqual(shape("hey @ada!"), ["text:hey ", "mention:@ada", "text:!"]);
});

test("a hashtag is a hashtag, sigil included", () => {
  assert.deepEqual(shape("#peel"), ["hashtag:#peel"]);
  assert.deepEqual(shape("a #peel a day"), ["text:a ", "hashtag:#peel", "text: a day"]);
});

test("the tokens put the original text back together exactly", () => {
  // The renderer joins these back up, so nothing may be dropped or invented.
  for (const text of [
    "",
    "no sigils here",
    "@ada and @bob_2 talking about #citrus and #Fruit_99!",
    "email ada@bobmail.com, tag #a, stray @ and # and @ab",
    "  leading and trailing  ",
    "multi\nline @ada\n#peel",
  ]) {
    assert.equal(
      tokenize(text)
        .map((t) => t.value)
        .join(""),
      text,
      text,
    );
  }
});

test("a handle needs 3 to 20 characters of [a-z0-9_]", () => {
  assert.deepEqual(shape("@ab"), ["text:@ab"]); // 2 is too short
  assert.deepEqual(shape("@abc"), ["mention:@abc"]);
  assert.deepEqual(shape("@" + "a".repeat(20)), ["mention:@" + "a".repeat(20)]);
  // 21 characters: the first 20 are the handle, the rest is ordinary text --
  // same as the database's greedy {3,20} match, so both agree on who is notified.
  assert.deepEqual(shape("@" + "a".repeat(21)), ["mention:@" + "a".repeat(20), "text:a"]);
  assert.deepEqual(shape("@a_9_b"), ["mention:@a_9_b"]);
});

test("handles match in any case, because GitHub logins are case-insensitive", () => {
  assert.deepEqual(shape("@Ada"), ["mention:@Ada"]);
  assert.deepEqual(shape("@ADA_99"), ["mention:@ADA_99"]);
  assert.deepEqual(shape("@adaX"), ["mention:@adaX"]);
  // Still 3 characters at least, whatever the case.
  assert.deepEqual(shape("@aB"), ["text:@aB"]);
  // And still 20 at most, counted over the mixed-case run.
  assert.deepEqual(shape("@" + "Ab".repeat(11)), ["mention:@" + "Ab".repeat(10), "text:Ab"]);
});

test("a mention carries the lower-case handle to link to, and nothing else does", () => {
  // The value is what the author typed; the handle is what /u/<handle> needs.
  assert.deepEqual(handles("Hey @Ada and @bob_2 about #Citrus"), ["ada", "bob_2"]);
  for (const token of tokenize("plain #Tag text")) {
    if (token.type !== "mention") assert.equal(token.handle, undefined);
  }
  const [mention] = tokenize("@Ada");
  assert.equal(mention.value, "@Ada");
  assert.equal(mention.handle, "ada");
});

test("a hashtag takes letters, digits and underscores from any script", () => {
  assert.deepEqual(shape("#a"), ["hashtag:#a"]);
  assert.deepEqual(shape("#Citrus_99"), ["hashtag:#Citrus_99"]);
  assert.deepEqual(shape("#naranja"), ["hashtag:#naranja"]);
  assert.deepEqual(shape("#кожура"), ["hashtag:#кожура"]);
  assert.deepEqual(shape("#みかん"), ["hashtag:#みかん"]);
  assert.deepEqual(shape("#" + "a".repeat(50)), ["hashtag:#" + "a".repeat(50)]);
  assert.deepEqual(shape("#" + "a".repeat(51)), ["hashtag:#" + "a".repeat(50), "text:a"]);
  // Punctuation ends a tag rather than joining it.
  assert.deepEqual(shape("#peel-it"), ["hashtag:#peel", "text:-it"]);
  assert.deepEqual(shape("#peel."), ["hashtag:#peel", "text:."]);
});

test("a bare sigil, or one with nothing usable after it, is text", () => {
  assert.deepEqual(shape("@"), ["text:@"]);
  assert.deepEqual(shape("#"), ["text:#"]);
  assert.deepEqual(shape("@ #"), ["text:@ #"]);
  assert.deepEqual(shape("#-"), ["text:#-"]);
});

test("a sigil glued to a word is part of that word, so email addresses survive", () => {
  assert.deepEqual(shape("ada@bobmail"), ["text:ada@bobmail"]);
  assert.deepEqual(shape("ada@bobmail.com"), ["text:ada@bobmail.com"]);
  assert.deepEqual(shape("a@b"), ["text:a@b"]);
  assert.deepEqual(shape("C#sharp"), ["text:C#sharp"]);
  assert.deepEqual(shape("9#nine"), ["text:9#nine"]);
  // Non-ASCII letters count as word characters too.
  assert.deepEqual(shape("café@ada"), ["text:café@ada"]);
  // But punctuation before the sigil does not glue it.
  assert.deepEqual(shape("(@ada)"), ["text:(", "mention:@ada", "text:)"]);
  assert.deepEqual(shape("-@ada"), ["text:-", "mention:@ada"]);
  assert.deepEqual(shape("\n@ada"), ["text:\n", "mention:@ada"]);
});

test("adjacent handles: the second is glued to the first, so it is text", () => {
  assert.deepEqual(shape("@ada@bob"), ["mention:@ada", "text:@bob"]);
  // Separated by anything at all, both are mentions.
  assert.deepEqual(shape("@ada @bob"), ["mention:@ada", "text: ", "mention:@bob"]);
  assert.deepEqual(shape("@ada,@bob"), ["mention:@ada", "text:,", "mention:@bob"]);
});

test("mentions and hashtags mix in one line", () => {
  assert.deepEqual(shape("@ada tried #citrus, @bob did not"), [
    "mention:@ada",
    "text: tried ",
    "hashtag:#citrus",
    "text:, ",
    "mention:@bob",
    "text: did not",
  ]);
});

test("extractMentions returns the bare handles, in order, without repeats", () => {
  assert.deepEqual(extractMentions("@ada and @bob and @ada again"), ["ada", "bob"]);
  assert.deepEqual(extractMentions("no handles here"), []);
  assert.deepEqual(extractMentions(""), []);
  assert.deepEqual(extractMentions("#citrus is not a handle"), []);
  assert.deepEqual(extractMentions("mail ada@bobmail.com"), []);
  assert.deepEqual(extractMentions("@a_9 @ab @abc"), ["a_9", "abc"]);
});

test("extractMentions lower-cases, so @Ada and @ada are one person", () => {
  assert.deepEqual(extractMentions("@Ada and @ada and @ADA"), ["ada"]);
  assert.deepEqual(extractMentions("@Bob_2 met @CARLA"), ["bob_2", "carla"]);
});

test("a link is its own token, sigils inside it included", () => {
  assert.deepEqual(shape("https://ada.dev"), ["link:https://ada.dev"]);
  assert.deepEqual(shape("read https://ada.dev/notes now"), [
    "text:read ",
    "link:https://ada.dev/notes",
    "text: now",
  ]);
  // The @ and the # are part of the address, not a mention and not a tag.
  assert.deepEqual(shape("https://x.com/@bob#top"), ["link:https://x.com/@bob#top"]);
  assert.deepEqual(extractMentions("https://x.com/@bob"), []);
});

test("the punctuation that ends the sentence is not part of the link", () => {
  assert.deepEqual(shape("see https://ada.dev/notes."), ["text:see ", "link:https://ada.dev/notes", "text:."]);
  assert.deepEqual(shape("https://ada.dev/a, and more"), ["link:https://ada.dev/a", "text:, and more"]);
  assert.deepEqual(shape("(see https://ada.dev/a)"), ["text:(see ", "link:https://ada.dev/a", "text:)"]);
  assert.deepEqual(shape("really? https://ada.dev/a?!"), [
    "text:really? ",
    "link:https://ada.dev/a",
    "text:?!",
  ]);
});

test("a bracket the url itself opened stays in the url", () => {
  assert.deepEqual(shape("https://en.wikipedia.org/wiki/Kochi_(India)"), [
    "link:https://en.wikipedia.org/wiki/Kochi_(India)",
  ]);
  // The outer bracket is the sentence's, the inner one is the address's.
  assert.deepEqual(shape("(https://en.wikipedia.org/wiki/Kochi_(India))"), [
    "text:(",
    "link:https://en.wikipedia.org/wiki/Kochi_(India)",
    "text:)",
  ]);
});

test("a scheme glued to a word is not a link, and neither is a bare scheme", () => {
  assert.deepEqual(shape("xhttps://ada.dev"), ["text:xhttps://ada.dev"]);
  assert.deepEqual(shape("https://."), ["text:https://", "text:."]);
  assert.deepEqual(shape("ftp://ada.dev/x"), ["text:ftp://ada.dev/x"]);
  assert.deepEqual(shape("ada.dev/notes"), ["text:ada.dev/notes"]);
});

test("plain http links too -- the renderer decides what to do about the scheme", () => {
  assert.deepEqual(shape("http://ada.dev/x"), ["link:http://ada.dev/x"]);
});

test("joining every token's value back together reproduces the input", () => {
  for (const text of [
    "see https://ada.dev/notes. thanks @ada #citrus",
    "(https://en.wikipedia.org/wiki/Kochi_(India)) and https://ada.dev/a,",
    "https://. https://ada.dev @bob",
    "nothing live in here at all",
  ]) {
    assert.equal(
      tokenize(text)
        .map((t) => t.value)
        .join(""),
      text,
    );
  }
});
