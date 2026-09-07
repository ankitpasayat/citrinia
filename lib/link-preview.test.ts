// Spec: a peel that carries a link gets a card under it saying what is on the
// other end. This file is the arithmetic half of that.
//
// firstPreviewLink picks which link gets the card: the first one that is not a
// YouTube link, because those are already a player and a still. previewSite is
// what the card says the link goes to -- built from the url every time, never
// from the stored row, because the row can be written by anybody signed in and
// the url cannot. parseOpenGraph reads a page's own og: tags, falling back to
// <title> and <meta name=description> so a page with no OG tags at all still
// gives the compact row. isPublicAddress is the SSRF guard: it answers "is this
// address out on the internet", and anything it does not understand is a no.
import test from "node:test";
import assert from "node:assert/strict";
import {
  firstPreviewLink,
  isPublicAddress,
  MAX_PREVIEW_DESCRIPTION,
  MAX_PREVIEW_TITLE,
  parseOpenGraph,
  previewSite,
} from "./link-preview.ts";

const PAGE = "https://ada.dev/notes";

test("the card goes to the first link in the peel", () => {
  assert.equal(firstPreviewLink("read https://ada.dev/notes today"), "https://ada.dev/notes");
  assert.equal(firstPreviewLink("https://one.example/a then https://two.example/b"), "https://one.example/a");
  assert.equal(firstPreviewLink("no links here"), null);
  assert.equal(firstPreviewLink(""), null);
  // Punctuation the sentence put there is not part of the link (see text.ts).
  assert.equal(firstPreviewLink("see https://ada.dev/notes."), "https://ada.dev/notes");
});

test("a YouTube link is skipped -- it is already a player", () => {
  assert.equal(firstPreviewLink("https://youtu.be/dQw4w9WgXcQ"), null);
  assert.equal(firstPreviewLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(firstPreviewLink("https://www.youtube.com/shorts/dQw4w9WgXcQ"), null);
  // ...and the link after it still gets the card.
  assert.equal(
    firstPreviewLink("https://youtu.be/dQw4w9WgXcQ and https://ada.dev/notes"),
    "https://ada.dev/notes",
  );
});

test("a mention or a hashtag is not a link", () => {
  assert.equal(firstPreviewLink("@ada #citrus ada.dev/notes"), null);
});

test("the site line is the hostname, without the www", () => {
  assert.equal(previewSite("https://www.nytimes.com/2026/09/07/x.html"), "nytimes.com");
  assert.equal(previewSite("https://ada.dev/notes"), "ada.dev");
  assert.equal(previewSite("https://EN.Wikipedia.ORG/wiki/Kochi"), "en.wikipedia.org");
  assert.equal(previewSite("not a url"), "");
});

test("open graph tags become the three lines of the card", () => {
  const og = parseOpenGraph(
    `<html><head>
       <meta property="og:title" content="The peel of it">
       <meta property="og:description" content="A short line about peels.">
       <meta property="og:image" content="https://ada.dev/card.png">
     </head><body>ignored</body></html>`,
    PAGE,
  );
  assert.deepEqual(og, {
    title: "The peel of it",
    description: "A short line about peels.",
    imageUrl: "https://ada.dev/card.png",
  });
});

test("a page with no og tags falls back to its title and description", () => {
  const og = parseOpenGraph(
    `<html><head><title>Ada's notes</title>
       <meta name="description" content="Notes, mostly about citrus."></head></html>`,
    PAGE,
  );
  assert.equal(og.title, "Ada's notes");
  assert.equal(og.description, "Notes, mostly about citrus.");
  assert.equal(og.imageUrl, null);
});

test("a page with nothing at all gives nothing, rather than an empty card", () => {
  const og = parseOpenGraph("<html><head></head><body><h1>hello</h1></body></html>", PAGE);
  assert.deepEqual(og, { title: null, description: null, imageUrl: null });
  // An empty title tag is not a title.
  assert.equal(parseOpenGraph("<html><head><title>  </title></head></html>", PAGE).title, null);
});

test("only the head is read: a meta tag in the body is not metadata", () => {
  const og = parseOpenGraph(
    `<html><head><title>Real</title></head>
     <body><meta property="og:title" content="Injected"></body></html>`,
    PAGE,
  );
  assert.equal(og.title, "Real");
});

test("attributes are read whatever their order and quoting", () => {
  assert.equal(
    parseOpenGraph(`<head><meta content='Single quoted' property='og:title'></head>`, PAGE).title,
    "Single quoted",
  );
  assert.equal(
    parseOpenGraph(`<head><meta property=og:title content=Unquoted></head>`, PAGE).title,
    "Unquoted",
  );
  assert.equal(
    parseOpenGraph(`<head><meta  PROPERTY = "OG:TITLE"  CONTENT = "Shouty" ></head>`, PAGE).title,
    "Shouty",
  );
});

test("the first of a repeated tag wins, and og beats the fallback", () => {
  const html = `<head><title>Fallback</title>
    <meta property="og:title" content="First">
    <meta property="og:title" content="Second"></head>`;
  assert.equal(parseOpenGraph(html, PAGE).title, "First");
});

test("entities are decoded and pretty-printed whitespace is collapsed", () => {
  const og = parseOpenGraph(
    `<head><meta property="og:title" content="Ada &amp; Bob&#39;s caf&#xe9;">
      <meta property="og:description" content="one
      two    three"></head>`,
    PAGE,
  );
  assert.equal(og.title, "Ada & Bob's café");
  assert.equal(og.description, "one two three");
});

test("a title longer than the column allows is cut, not refused", () => {
  const long = "a".repeat(MAX_PREVIEW_TITLE + 50);
  const og = parseOpenGraph(`<head><meta property="og:title" content="${long}"></head>`, PAGE);
  assert.equal(og.title?.length, MAX_PREVIEW_TITLE);
  assert.ok(og.title?.endsWith("…"));

  const longer = "b".repeat(MAX_PREVIEW_DESCRIPTION + 50);
  const desc = parseOpenGraph(`<head><meta property="og:description" content="${longer}"></head>`, PAGE);
  assert.equal(desc.description?.length, MAX_PREVIEW_DESCRIPTION);
});

test("a relative og:image resolves against the page it was declared on", () => {
  assert.equal(
    parseOpenGraph(`<head><meta property="og:image" content="/card.png"></head>`, PAGE).imageUrl,
    "https://ada.dev/card.png",
  );
  assert.equal(
    parseOpenGraph(`<head><meta property="og:image" content="card.png"></head>`, PAGE).imageUrl,
    "https://ada.dev/card.png",
  );
});

test("an og:image that is not http(s) is not an image", () => {
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "  "]) {
    assert.equal(
      parseOpenGraph(`<head><meta property="og:image" content="${bad}"></head>`, PAGE).imageUrl,
      null,
      bad,
    );
  }
});

//------------------------------------------------------------------------------
// The address guard
//------------------------------------------------------------------------------

test("an ordinary public address is public", () => {
  for (const ip of ["93.184.216.34", "1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "198.20.0.1"]) {
    assert.equal(isPublicAddress(ip, 4), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicAddress(ip, 6), true, ip);
  }
});

test("nothing the server can reach privately is public", () => {
  for (const ip of [
    "127.0.0.1", // loopback
    "127.1.2.3",
    "0.0.0.0", // every local interface
    "0.1.2.3",
    "10.0.0.5", // private
    "172.16.0.1", // private
    "172.31.255.255",
    "192.168.1.1", // private
    "169.254.169.254", // link-local: the cloud metadata address, the whole point
    "100.64.0.1", // carrier-grade NAT
    "192.0.0.1",
    "192.88.99.1",
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "255.255.255.255", // broadcast
  ]) {
    assert.equal(isPublicAddress(ip, 4), false, ip);
  }
});

test("the same holds in IPv6, including an IPv4 address wearing a hat", () => {
  for (const ip of [
    "::1", // loopback
    "::", // unspecified
    "fc00::1", // unique local
    "fd12:3456::1",
    "fe80::1", // link-local
    "fec0::1", // deprecated site-local
    "ff02::1", // multicast
    "::ffff:127.0.0.1", // v4-mapped loopback
    "::ffff:169.254.169.254",
    "::ffff:0:127.0.0.1",
    "::127.0.0.1", // v4-compatible loopback
    "2002:7f00:0001::", // 6to4, which carries a v4 address inside it
    "64:ff9b::7f00:1", // NAT64, likewise
  ]) {
    assert.equal(isPublicAddress(ip, 6), false, ip);
  }
});

test("anything the guard cannot read is not public", () => {
  for (const ip of ["", "not an address", "999.1.1.1", "1.2.3", "1.2.3.4.5", "::ffff:1::2", "12345::"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("the family is taken from the resolver when it says, and read off the text when it does not", () => {
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("::1"), false);
});
