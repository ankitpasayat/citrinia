// Spec: the composer sends its attachments as one JSON form field. parseMedia()
// is the gate between that string and the peel_media table, so it has to reject
// everything the table's constraints would reject (https urls, four kinds, 200
// characters of alt) plus the two rules the table cannot express: at most four
// attachments, and a video or a YouTube link peels on its own.
//
// Alt text is required for images and gifs -- a picture with no description is
// unreadable to anyone using a screen reader -- but not for video or YouTube,
// which carry their own.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ALT, MAX_MEDIA, parseMedia, youtubeId, youtubeThumbnail } from "./media.ts";

const IMAGE = { kind: "image", url: "https://cdn.example.com/lemon.png", alt: "a lemon" };

test("loopback http URLs from a local Supabase stack are accepted; other http is not", () => {
  const local = parseMedia(JSON.stringify([{ ...IMAGE, url: "http://127.0.0.1:54321/storage/v1/object/public/media/u/x.png" }]));
  assert.ok(Array.isArray(local), "127.0.0.1 accepted");
  const localhost = parseMedia(JSON.stringify([{ ...IMAGE, url: "http://localhost:54321/storage/v1/object/public/media/u/x.png" }]));
  assert.ok(Array.isArray(localhost), "localhost accepted");
  const remote = parseMedia(JSON.stringify([{ ...IMAGE, url: "http://cdn.example.com/lemon.png" }]));
  assert.ok(!Array.isArray(remote) && "error" in remote, "plain http rejected");
});

/** parseMedia takes the raw form value, which is a JSON string or nothing. */
function parse(items: unknown) {
  return parseMedia(JSON.stringify(items));
}

function ok(result: PeelMedia[] | { error: string }): PeelMedia[] {
  assert.ok(Array.isArray(result), `expected media, got ${JSON.stringify(result)}`);
  return result;
}

function err(result: PeelMedia[] | { error: string }): string {
  assert.ok(!Array.isArray(result), `expected an error, got ${JSON.stringify(result)}`);
  return result.error;
}

test("no media field at all means no media, not an error", () => {
  assert.deepEqual(parseMedia(null), []);
  assert.deepEqual(parseMedia(undefined), []);
  assert.deepEqual(parseMedia(""), []);
  assert.deepEqual(parse([]), []);
});

test("a well-formed image comes back normalised", () => {
  const [media] = ok(parse([{ ...IMAGE, width: 800, height: 600 }]));
  assert.deepEqual(media, {
    kind: "image",
    url: "https://cdn.example.com/lemon.png",
    alt: "a lemon",
    width: 800,
    height: 600,
  });
});

test("missing dimensions become null rather than undefined", () => {
  const [media] = ok(parse([IMAGE]));
  assert.equal(media.width, null);
  assert.equal(media.height, null);
});

test("alt text is trimmed, and the item order is kept", () => {
  const items = ok(
    parse([
      { ...IMAGE, alt: "  first  " },
      { ...IMAGE, url: "https://cdn.example.com/2.png", alt: "second" },
    ]),
  );
  assert.deepEqual(
    items.map((m) => [m.alt, m.url]),
    [
      ["first", "https://cdn.example.com/lemon.png"],
      ["second", "https://cdn.example.com/2.png"],
    ],
  );
});

test("four attachments are fine, five are not", () => {
  assert.equal(MAX_MEDIA, 4);
  const four = [1, 2, 3, 4].map((n) => ({ ...IMAGE, url: `https://cdn.example.com/${n}.png` }));
  assert.equal(ok(parse(four)).length, 4);
  assert.match(err(parse([...four, IMAGE])), /four/i);
});

test("the field has to be a JSON array of objects", () => {
  assert.ok(err(parseMedia("not json")));
  assert.ok(err(parseMedia("{}")));
  assert.ok(err(parse("a string")));
  assert.ok(err(parse([null])));
  assert.ok(err(parse(["https://cdn.example.com/1.png"])));
  assert.ok(err(parseMedia(123)));
});

test("only the four known kinds are accepted", () => {
  for (const kind of ["image", "gif"]) {
    assert.equal(ok(parse([{ ...IMAGE, kind }]))[0].kind, kind);
  }
  assert.equal(ok(parse([{ kind: "video", url: "https://cdn.example.com/v.mp4", alt: "" }]))[0].kind, "video");
  assert.equal(
    ok(parse([{ kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", alt: "" }]))[0].kind,
    "youtube",
  );
  assert.ok(err(parse([{ ...IMAGE, kind: "audio" }])));
  assert.ok(err(parse([{ ...IMAGE, kind: "" }])));
  assert.ok(err(parse([{ url: IMAGE.url, alt: "x" }])));
});

test("urls must be https, matching the table's check constraint", () => {
  assert.ok(err(parse([{ ...IMAGE, url: "http://cdn.example.com/lemon.png" }])));
  assert.ok(err(parse([{ ...IMAGE, url: "javascript:alert(1)" }])));
  assert.ok(err(parse([{ ...IMAGE, url: "data:image/png;base64,AAAA" }])));
  assert.ok(err(parse([{ ...IMAGE, url: "//cdn.example.com/lemon.png" }])));
  assert.ok(err(parse([{ ...IMAGE, url: "" }])));
  assert.ok(err(parse([{ ...IMAGE, url: "  " }])));
  assert.ok(err(parse([{ ...IMAGE, url: 42 }])));
  // Case in the scheme is not the author's problem.
  assert.equal(ok(parse([{ ...IMAGE, url: "HTTPS://cdn.example.com/x.png" }]))[0].url.startsWith("https://"), true);
});

test("images and gifs need alt text; video and youtube do not", () => {
  assert.match(err(parse([{ ...IMAGE, alt: "" }])), /alt/i);
  assert.match(err(parse([{ ...IMAGE, alt: "   " }])), /alt/i);
  assert.match(err(parse([{ ...IMAGE, kind: "gif", alt: "" }])), /alt/i);
  assert.ok(err(parse([{ kind: "image", url: IMAGE.url }])));
  assert.equal(ok(parse([{ kind: "video", url: "https://cdn.example.com/v.mp4" }]))[0].alt, "");
  assert.equal(ok(parse([{ kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }]))[0].alt, "");
});

test("alt text stops at 200 characters, the same as the column", () => {
  assert.equal(MAX_ALT, 200);
  assert.equal(ok(parse([{ ...IMAGE, alt: "x".repeat(200) }]))[0].alt.length, 200);
  assert.ok(err(parse([{ ...IMAGE, alt: "x".repeat(201) }])));
  // Counted the way Postgres char_length() counts, in code points.
  assert.ok(err(parse([{ ...IMAGE, alt: "🍋".repeat(201) }])));
  assert.equal(ok(parse([{ ...IMAGE, alt: "🍋".repeat(200) }]))[0].alt.length > 200, true);
});

test("a video or a youtube link peels on its own", () => {
  const video = { kind: "video", url: "https://cdn.example.com/v.mp4" };
  const tube = { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" };
  assert.equal(ok(parse([video])).length, 1);
  assert.equal(ok(parse([tube])).length, 1);
  assert.match(err(parse([video, IMAGE])), /on its own/i);
  assert.match(err(parse([IMAGE, video])), /on its own/i);
  assert.match(err(parse([video, tube])), /on its own/i);
  assert.match(err(parse([tube, tube])), /on its own/i);
});

test("dimensions must be positive whole numbers when they are given", () => {
  assert.equal(ok(parse([{ ...IMAGE, width: null, height: null }]))[0].width, null);
  assert.ok(err(parse([{ ...IMAGE, width: 0 }])));
  assert.ok(err(parse([{ ...IMAGE, width: -10 }])));
  assert.ok(err(parse([{ ...IMAGE, height: 1.5 }])));
  assert.ok(err(parse([{ ...IMAGE, width: "800" }])));
  // NaN and Infinity cannot survive the JSON trip (they arrive as null), so the
  // non-number case that can actually reach us is a value of another type.
  assert.ok(err(parse([{ ...IMAGE, height: true }])));
});

test("youtubeId reads watch, youtu.be and shorts links", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeId(`https://youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeId(`https://m.youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${id}&t=42s`), id);
  assert.equal(youtubeId(`https://youtu.be/${id}`), id);
  assert.equal(youtubeId(`https://youtu.be/${id}?t=42`), id);
  assert.equal(youtubeId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(youtubeId(`https://youtube.com/shorts/${id}?feature=share`), id);
});

test("youtubeId returns null for anything that is not one of those", () => {
  assert.equal(youtubeId("https://vimeo.com/123456"), null);
  assert.equal(youtubeId("https://www.youtube.com/watch?v=tooshort"), null);
  assert.equal(youtubeId("https://www.youtube.com/"), null);
  assert.equal(youtubeId("https://youtu.be/"), null);
  assert.equal(youtubeId("https://www.youtube.com/watch"), null);
  // Not youtube, however much it looks like it.
  assert.equal(youtubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeId("not a url"), null);
  assert.equal(youtubeId(""), null);
});

test("youtubeThumbnail builds the still for an id", () => {
  assert.equal(
    youtubeThumbnail("dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});
