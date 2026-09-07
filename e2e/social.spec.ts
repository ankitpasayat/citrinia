// The social layer, driven end to end in a real browser against the same local
// stack and the same two accounts as mvp.spec.ts. It picks the narrative up
// where that one left it -- ada's peel with its reply, bob's peel, bob following
// ada, and bob renamed "Bob Peeler" by mvp test 7 -- so it runs last (see the
// `social` project in playwright.config.ts).
import { createServer, type Server } from "node:http";
import { deflateSync } from "node:zlib";
import { BASE_URL } from "../playwright.config.ts";
import { actionWrite, card, expect, REMOTE_IMAGE, shot, subscribed, test, type Page } from "./fixtures.ts";
import {
  listUploads,
  makeExtras,
  makeGuest,
  peelAs,
  publicUrl,
  removeExtras,
  restAs,
  restAsGuest,
  restAsService,
} from "./db.ts";

// Slice 9: a page for a link card to be about, served from this machine for the
// length of the run. The app follows a loopback url only when
// LINK_PREVIEW_TEST_ORIGIN names this exact origin -- the e2e command in the
// README exports it, and production has no such exception at all.
const OG_PORT = 3211;
const OG_ORIGIN = `http://127.0.0.1:${OG_PORT}`;
const OG_TITLE = "Marmalade, the long read";
const OG_DESCRIPTION = "Everything that happens between a fruit and a jar.";
const BARE_TITLE = "A page that never heard of Open Graph";
/** How often the page with the tags was actually fetched. One, however often it is shared. */
let ogFetches = 0;
let ogServer: Server;

test.beforeAll(async () => {
  ogServer = createServer((request, response) => {
    switch ((request.url ?? "/").split("?")[0]) {
      case "/og":
        ogFetches += 1;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(`<!doctype html><html><head>
          <meta property="og:title" content="${OG_TITLE}">
          <meta property="og:description" content="${OG_DESCRIPTION}">
          <meta property="og:image" content="/card.svg">
        </head><body>the page itself</body></html>`);
      case "/bare":
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(`<html><head><title>${BARE_TITLE}</title></head><body>hello</body></html>`);
      case "/card.svg":
        response.writeHead(200, { "content-type": "image/svg+xml" });
        return response.end(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#E8C547"/></svg>',
        );
      default:
        response.writeHead(404);
        return response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    ogServer.once("error", reject);
    ogServer.listen(OG_PORT, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => ogServer.close(() => resolve()));
});

declare global {
  interface Window {
    /** What the stubbed share sheet was handed, in the browser that has one. */
    shared?: { title: string; url: string }[];
  }
}

// What mvp.spec.ts leaves behind. Asserted in test 1, so a change over there
// fails here with a reason rather than a mystery.
const ADA_PEEL = "first peel from ada 🍊";
const BOB_PEEL = "bob peels in from the outside";
const BOB = "Bob Peeler";

const QUOTE = "adding context";
const BOB_REPLY = "bob says something back";
const MENTION = "hello @ada, #citrus season";
// Neither @ here starts a word, so neither is a mention: one is an address with
// ada in front of it, the other an address with ada behind it.
const ADDRESSES = "mail ada@bobmail or bob@ada about the pith";
const TUBE = "watch this https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VIDEO_ID = "dQw4w9WgXcQ";
const PICTURE = "a picture of an orange square";
const FRESH = "a fresh peel while ada watches";
const OTHER_FRESH = "and another one right after";
const THREAD_REPLY = "one more from the thread";

// A three-deep conversation for the ancestors test: ada starts it, bob answers
// her, ada answers him. Opening the last one has to show the first two above it.
// Slice 6: something to flag, something of bob's own that offers no flag, and a
// peel whose author is about to close their account.
const REPORTABLE = "a peel worth telling somebody about";
const BOB_OWN = "bob has nothing to report about himself";
const LEAVING = "posted by somebody on their way out";

// Slice 7: ada goes quiet for bob. Distinct words, because the mute is proved by
// a card being absent, and an absence is only meaningful if the text is unique.
const MUTED_PEEL = "marmalade thoughts nobody asked for";
const MUTED_REPLY = "and another marmalade thought";
const BOB_THREAD = "bob starts something for ada to answer";

// ...and carol goes further than quiet.
const CAROL_PEEL = "carol has candied peel opinions";
const BOB_BEFORE_BLOCK = "bob peels before any of this";

// Test 22: one tag three people use, and one tag one person uses three times.
const ZEST = "zest is the best part";
const LOUD = "saying it again";

const CHAIN_ROOT = "what is the correct number of oranges";
const CHAIN_MIDDLE = "one more than you have";
const CHAIN_LEAF = "that is not a number, bob";
const SHAREABLE = "a peel worth passing on";

/** How many older peels test 8 bulk-loads. PAGE_SIZE in lib/peels.ts is 20. */
const OLDER = 25;
/** How many throwaway followers test 13 makes: one more than a page of 20. */
const PIPS = 21;
const olderTitle = (n: number) => `older peel ${String(n).padStart(2, "0")}`;

// app/tokens.stylex.ts, light values. Playwright's default colorScheme is light.
const BURNT = "rgb(212, 85, 27)"; // colors.burnt #D4551B
const TRANSPARENT = "rgba(0, 0, 0, 0)";

test.describe.configure({ mode: "serial" });

//------------------------------------------------------------------------------
// Locators
//------------------------------------------------------------------------------

/**
 * The card for one peel by id. `card()` matches on text, which stops telling one
 * card from another the moment a quote embeds somebody's words inside another
 * peel -- the "Open this peel" timestamp link belongs to the outer card alone.
 */
function peelCard(page: Page, id: string) {
  return page
    .getByRole("article")
    .filter({ has: page.locator(`a[aria-label="Open this peel"][href="/p/${id}"]`) });
}

/** The repeel chip, whatever its count says. */
function repeelChip(scope: ReturnType<typeof card>) {
  return scope.getByRole("button", { name: /^Repeel, / });
}

/** One row of the notifications screen, by what it says. */
function alert(page: Page, said: string) {
  return page.getByRole("link").filter({ hasText: `${BOB} ${said}` });
}

/** The throwaway people listed on the page, in order, by where their row points. */
function pipHrefs(page: Page): Promise<string[]> {
  return page
    .locator('a[href^="/u/pip"]')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""));
}

/** The peel ids on the page, in order, straight off the timestamp links. */
function shownIds(page: Page): Promise<string[]> {
  return page
    .getByRole("link", { name: "Open this peel" })
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""));
}

//------------------------------------------------------------------------------
// Out-of-band reads
//------------------------------------------------------------------------------

/** The id of the one peel with this exact title. */
async function peelId(title: string): Promise<string> {
  const rows = await restAsService().select<{ id: string }>(
    `peels?select=id&title=eq.${encodeURIComponent(title)}`,
  );
  expect(rows, `exactly one peel titled "${title}"`).toHaveLength(1);
  return rows[0].id;
}

/** Ada's notifications of one type, however many there are. */
async function alertsFor(adaId: string, type: string): Promise<{ id: number }[]> {
  return restAsService().select<{ id: number }>(
    `notifications?select=id&user_id=eq.${adaId}&type=eq.${type}`,
  );
}

//------------------------------------------------------------------------------
// A real PNG, built here so the upload has honest bytes and honest dimensions
//------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const be32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const tagged = concat([new Uint8Array([...type].map((c) => c.charCodeAt(0))), data]);
  return concat([be32(data.length), tagged, be32(crc32(tagged))]);
}

/** A `size`×`size` truecolour PNG of one colour. Real bytes, so the browser can
 *  read real dimensions off it and peel_media gets a width and a height. */
function png(size: number, rgb: [number, number, number]): Uint8Array {
  const stride = size * 3 + 1;
  const raw = new Uint8Array(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set(rgb, y * stride + 1 + x * 3);
  }
  const ihdr = concat([be32(size), be32(size), new Uint8Array([8, 2, 0, 0, 0])]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const SQUARE = Buffer.from(png(64, [212, 85, 27]));
const OVER_5MB = Buffer.alloc(5 * 1024 * 1024 + 1);

//------------------------------------------------------------------------------

test("1. bob repeels ada's peel, and takes it back", async ({ open }) => {
  const bob = await open("bob");
  await bob.goto("/");

  // The state mvp.spec.ts hands over. If this is wrong, nothing below means much.
  await expect(card(bob, ADA_PEEL)).toHaveCount(1);
  await expect(card(bob, BOB_PEEL)).toHaveCount(1);

  const chip = repeelChip(card(bob, ADA_PEEL));
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(chip).toHaveAccessibleName("Repeel, 0 repeels");

  await chip.click();
  const repeeled = actionWrite(bob);
  await card(bob, ADA_PEEL).getByRole("button", { name: "Repeel", exact: true }).click();
  await repeeled;

  // Ada's peel is now on the timeline twice: once as itself, once as bob's
  // repeel of it, and the repeel is the newer of the two events.
  const row = bob.getByRole("article").filter({ hasText: `Repeeled by ${BOB}` });
  await expect(row).toHaveCount(1);
  await expect(bob.getByRole("article").first()).toContainText(`Repeeled by ${BOB}`);
  await expect(row).toContainText(ADA_PEEL);
  await expect(row.getByRole("link", { name: BOB })).toHaveAttribute("href", "/u/bob");
  // Both copies of the peel carry the pressed chip; they are the same peel.
  await expect(bob.getByRole("button", { name: "Repeel, 1 repeel" })).toHaveCount(2);
  await expect(repeelChip(row)).toHaveAttribute("aria-pressed", "true");

  const ada = await open("ada");
  await ada.goto("/notifications");
  await expect(alert(ada, "repeeled your peel")).toHaveCount(1);
  await expect(alert(ada, "repeeled your peel")).toHaveAttribute(
    "href",
    `/p/${await peelId(ADA_PEEL)}`,
  );

  await repeelChip(row).click();
  const undone = actionWrite(bob);
  await row.getByRole("button", { name: "Undo repeel" }).click();
  await undone;

  await expect(bob.getByRole("article").filter({ hasText: `Repeeled by ${BOB}` })).toHaveCount(0);
  await expect(repeelChip(card(bob, ADA_PEEL))).toHaveAccessibleName("Repeel, 0 repeels");
  await expect(repeelChip(card(bob, ADA_PEEL))).toHaveAttribute("aria-pressed", "false");
});

test("2. bob quotes ada's peel, and her words ride along inside his", async ({ open }) => {
  const adaPeel = await peelId(ADA_PEEL);
  const bob = await open("bob");
  await bob.goto("/");

  await repeelChip(card(bob, ADA_PEEL)).click();
  await card(bob, ADA_PEEL).getByRole("button", { name: "Quote" }).click();

  const sheet = bob.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Quote peel" })).toBeVisible();
  // The preview is the peel being quoted, not a link out of the sheet.
  await expect(sheet).toContainText("Ada Lovelace");
  await expect(sheet).toContainText(ADA_PEEL);
  await expect(sheet.getByRole("link", { name: "Peel by Ada Lovelace" })).toHaveCount(0);

  await sheet.getByRole("textbox", { name: "Your quote" }).fill(QUOTE);
  const posted = actionWrite(bob);
  await sheet.getByRole("button", { name: "Peel it" }).click();
  await posted;

  const quoting = card(bob, QUOTE);
  await expect(quoting).toHaveCount(1);
  await expect(bob.getByRole("article").first()).toContainText(QUOTE);
  await expect(quoting).toContainText("Ada Lovelace");
  await expect(quoting).toContainText(ADA_PEEL);
  await expect(quoting.getByRole("link", { name: "Peel by Ada Lovelace" })).toHaveAttribute(
    "href",
    `/p/${adaPeel}`,
  );
  await shot(bob, "quote-mobile");

  const ada = await open("ada");
  await ada.goto("/notifications");
  await expect(alert(ada, "quoted your peel")).toHaveCount(1);
  await expect(alert(ada, "quoted your peel")).toContainText(QUOTE);
});

test("3. bob keeps ada's peel, then lets it go", async ({ open }) => {
  const adaPeel = await peelId(ADA_PEEL);
  const bob = await open("bob");
  await bob.goto("/");

  const mark = peelCard(bob, adaPeel).getByRole("button", { name: "Bookmark", exact: true });
  await expect(mark).toHaveAttribute("aria-pressed", "false");
  const saved = actionWrite(bob);
  await mark.click();
  await expect(peelCard(bob, adaPeel).getByRole("button", { name: "Remove bookmark" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await saved;

  await bob.goto("/bookmarks");
  await expect(bob.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
  await expect(bob.getByRole("article")).toHaveCount(1);
  await expect(peelCard(bob, adaPeel)).toContainText(ADA_PEEL);
  await shot(bob, "bookmarks-mobile");

  const dropped = actionWrite(bob);
  await peelCard(bob, adaPeel).getByRole("button", { name: "Remove bookmark" }).click();
  await dropped;
  await expect(bob.getByRole("heading", { name: "No bookmarks yet" })).toBeVisible();
  await expect(bob.getByRole("article")).toHaveCount(0);
});

test("4. every kind of notification reaches ada, and the badge empties", async ({ open }) => {
  const adaPeel = await peelId(ADA_PEEL);
  const bob = await restAs("bob");
  const ada = await restAs("ada");

  // Reading the screen is what marks a notification read, and tests 1 and 2 read
  // it -- so the three ada already has (bob's like and follow from the MVP
  // narrative, bob's quote from test 2) are put back the way they arrived. The
  // repeel was undone in test 1, so that one is made again.
  await restAsService().update(`notifications?user_id=eq.${ada.id}`, { read_at: null });
  await bob.insert("reposts", { user_id: bob.id, peel_id: adaPeel });
  const replyId = await peelAs("bob", BOB_REPLY, adaPeel);
  const quoteId = await peelId(QUOTE);

  const page = await open("ada");
  const bellListening = subscribed(page, "realtime:notifications:");
  await page.goto("/");
  await expect(page.getByRole("img", { name: "5 unread notifications" })).toBeVisible();

  // The bell keeps up without a navigation, in both directions: bob takes his
  // like back (the notification goes with it) and gives it again, while ada
  // just sits on the feed.
  await bellListening;
  await bob.remove(`likes?user_id=eq.${bob.id}&peel_id=eq.${adaPeel}`);
  await expect(page.getByRole("img", { name: "4 unread notifications" })).toBeVisible({
    timeout: 10_000,
  });
  await bob.insert("likes", { user_id: bob.id, peel_id: adaPeel });
  await expect(page.getByRole("img", { name: "5 unread notifications" })).toBeVisible({
    timeout: 10_000,
  });

  // The badge hangs off the bell, so the tab's own name carries it.
  await page.getByRole("link", { name: "Alerts" }).click();
  await expect(page).toHaveURL(/\/notifications$/);

  const rows: [string, string, string][] = [
    ["liked your peel", `/p/${adaPeel}`, ADA_PEEL],
    ["replied to your peel", `/p/${replyId}`, BOB_REPLY],
    ["quoted your peel", `/p/${quoteId}`, QUOTE],
    ["repeeled your peel", `/p/${adaPeel}`, ADA_PEEL],
    ["followed you", "/u/bob", "@bob"],
  ];
  for (const [said, href, detail] of rows) {
    await expect(alert(page, said), said).toHaveCount(1);
    await expect(alert(page, said), said).toHaveAttribute("href", href);
    await expect(alert(page, said), said).toContainText(detail);
  }
  await expect(page.getByRole("link").filter({ hasText: BOB })).toHaveCount(rows.length);
  // Opening the screen is the act of reading them, but the rows keep the tint
  // they arrived with so the reader can still see which ones were new.
  await expect(alert(page, "liked your peel")).toHaveCSS("border-left-color", BURNT);
  await shot(page, "notifications-mobile");

  // The list tells the tab bar rather than making it wait for a navigation.
  await expect(page.getByRole("img", { name: /unread notification/ })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("img", { name: /unread notification/ })).toHaveCount(0);
  await expect(alert(page, "liked your peel")).toHaveCSS("border-left-color", TRANSPARENT);
});

test("5. handles and hashtags are links; an address is not a mention", async ({ open }) => {
  const ada = await restAs("ada");
  const bob = await open("bob");
  await bob.goto("/");

  await bob.getByRole("button", { name: "New peel", exact: true }).click();
  await bob.getByRole("textbox", { name: "Your peel" }).fill(MENTION);
  const mentioned = actionWrite(bob);
  await bob.getByRole("button", { name: "Peel it" }).click();
  await mentioned;

  const mention = card(bob, MENTION);
  await expect(mention.getByRole("link", { name: "@ada", exact: true })).toHaveAttribute(
    "href",
    "/u/ada",
  );
  await expect(mention.getByRole("link", { name: "#citrus", exact: true })).toHaveAttribute(
    "href",
    "/explore?q=%23citrus",
  );
  // Posting refreshed the feed, so the peel he just wrote is already on it: his
  // own insert is not something to announce back to him.
  await expect(bob.getByRole("button", { name: /new peels?$/ })).toHaveCount(0);

  const page = await open("ada");
  await page.goto("/notifications");
  await expect(alert(page, "mentioned you")).toHaveCount(1);
  await expect(alert(page, "mentioned you")).toContainText(MENTION);
  const before = await alertsFor(ada.id, "mention");
  expect(before).toHaveLength(1);

  // An @ glued to a word is an address. Nothing links, and nobody is told.
  await bob.getByRole("button", { name: "New peel", exact: true }).click();
  await bob.getByRole("textbox", { name: "Your peel" }).fill(ADDRESSES);
  const posted = actionWrite(bob);
  await bob.getByRole("button", { name: "Peel it" }).click();
  await posted;

  const addresses = card(bob, ADDRESSES);
  await expect(addresses).toHaveCount(1);
  await expect(addresses.getByRole("link", { name: /^@/ })).toHaveCount(0);
  expect(await alertsFor(ada.id, "mention")).toHaveLength(1);
});

test("6. a youtube link becomes a still in the feed and a player on the peel", async ({ open }) => {
  const ada = await open("ada");
  await ada.goto("/");

  await ada.getByRole("button", { name: "New peel", exact: true }).click();
  await ada.getByRole("textbox", { name: "Your peel" }).fill(TUBE);
  await expect(ada.getByText("YouTube attached")).toBeVisible();
  const posted = actionWrite(ada);
  await ada.getByRole("button", { name: "Peel it" }).click();
  await posted;

  const still = card(ada, TUBE).getByRole("link", { name: "YouTube video shared by Ada Lovelace" });
  await expect(still).toBeVisible();
  await expect(still.locator("img")).toHaveAttribute(
    "src",
    `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
  );

  // On the peel itself the still is replaced by the player.
  await still.click();
  await expect(ada).toHaveURL(new RegExp(`/p/${await peelId(TUBE)}$`));
  await expect(
    ada.locator('iframe[title="YouTube video shared by Ada Lovelace"]'),
  ).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`);
  await expect(ada.getByRole("link", { name: /YouTube video shared by/ })).toHaveCount(0);
  await shot(ada, "thread-youtube-mobile");
});

test("7. ada attaches a picture, and the composer holds the line", async ({ open }) => {
  const adaId = (await restAs("ada")).id;
  const ada = await open("ada");
  await ada.goto("/");
  await ada.getByRole("button", { name: "New peel", exact: true }).click();

  const sheet = ada.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Your peel" }).fill(PICTURE);
  const picker = sheet.locator('input[type="file"]');
  // Scoped to the sheet, and to a filename: "Remove bookmark" is a button too.
  const attached = sheet.getByRole("button", { name: /^Remove .+\.png$/ });

  // Five is one too many, and none of them are attached.
  await picker.setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({
      name: `slice-${i}.png`,
      mimeType: "image/png",
      buffer: SQUARE,
    })),
  );
  await expect(ada.getByText("Four pictures at most.")).toBeVisible();
  await expect(attached).toHaveCount(0);

  // Neither is an image over 5 MB.
  await picker.setInputFiles([{ name: "huge.png", mimeType: "image/png", buffer: OVER_5MB }]);
  await expect(ada.getByText("huge.png is over 5 MB.")).toBeVisible();
  await expect(attached).toHaveCount(0);

  await picker.setInputFiles([
    { name: "orange-square.png", mimeType: "image/png", buffer: SQUARE },
  ]);
  await expect(attached).toHaveCount(1);
  // The filename is a starting point for alt text, never the answer.
  const alt = sheet.getByRole("textbox", { name: "Alt text for orange-square.png" });
  await expect(alt).toHaveValue("orange-square");
  await alt.fill("orange square");

  const before = await listUploads(adaId);
  const posted = actionWrite(ada);
  await sheet.getByRole("button", { name: "Peel it" }).click();
  await posted;

  // The file itself goes straight to the bucket, into the uploader's own folder,
  // and it really lands there: the public url serves it back.
  const uploaded = (await listUploads(adaId)).filter((path) => !before.includes(path));
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0].startsWith(`${adaId}/`)).toBe(true);
  const url = publicUrl(uploaded[0]);
  expect((await ada.request.get(url)).status()).toBe(200);

  // The loopback url the local stack serves is admitted by lib/media.ts (a
  // secure origin in browsers), so the peel posts with the picture on it.
  await expect(sheet).toBeHidden();
  const shownUpload = card(ada, PICTURE).getByRole("img", { name: "orange square" });
  await expect(shownUpload).toBeVisible();
  await expect(shownUpload).toHaveAttribute("src", url);

  // Composting the peel takes its upload with it: the object is removed from
  // the bucket on delete, not left for the nightly sweep.
  await card(ada, PICTURE).getByRole("button", { name: "More" }).click();
  await ada.getByRole("button", { name: "Delete peel" }).click();
  const deleted = actionWrite(ada);
  await ada.getByRole("button", { name: "Really delete? Tap again" }).click();
  await deleted;
  await expect(card(ada, PICTURE)).toHaveCount(0);
  await expect.poll(() => listUploads(adaId)).toEqual(before);

  // The card an upload produces from an https url on somebody's CDN, the way
  // the seed importer writes one: the rendering half of the same feature.
  const service = restAsService();
  const [peel] = await service.insert<{ id: string }>("peels", {
    title: PICTURE,
    user_id: adaId,
    parent_id: null,
  });
  await service.insert("peel_media", {
    peel_id: peel.id,
    position: 0,
    kind: "image",
    url: REMOTE_IMAGE,
    alt: "orange square",
    width: 64,
    height: 64,
  });

  await ada.goto("/");
  const shown = card(ada, PICTURE).getByRole("img", { name: "orange square" });
  await expect(shown).toBeVisible();
  await expect(shown).toHaveAttribute("src", REMOTE_IMAGE);
  // In the feed a picture opens the peel it hangs off; there is no lightbox.
  await expect(card(ada, PICTURE).getByRole("link", { name: "orange square" })).toHaveAttribute(
    "href",
    `/p/${peel.id}`,
  );
  await shot(ada, "feed-with-media-mobile");
});

test("8. a feed longer than a page shows older peels, and profile tabs sort them", async ({
  open,
}) => {
  const bob = await restAs("bob");
  const db = restAsService();

  // Every row of one insert shares the transaction's now(), so the clock is set
  // by hand, a minute apart -- except rows 13 and 14, which share an instant on
  // purpose: the page boundary falls between them (8 narrative rows plus 12 of
  // these fill page one), which is exactly where a time-only cursor lost a row.
  const start = Date.parse("2026-08-01T12:00:00.000Z");
  await db.insert(
    "peels",
    Array.from({ length: OLDER }, (_, i) => ({
      title: olderTitle(i + 1),
      user_id: bob.id,
      parent_id: null,
      created_at: new Date(start + (i + 1 === 14 ? 12 : i) * 60_000).toISOString(),
    })),
  );
  const tied = [await peelId(olderTitle(13)), await peelId(olderTitle(14))].map((id) => `/p/${id}`);

  const ada = await open("ada");
  await ada.goto("/");
  await expect(ada.getByRole("article")).toHaveCount(20);
  await expect(card(ada, olderTitle(OLDER))).toHaveCount(1);
  await expect(card(ada, olderTitle(1))).toHaveCount(0);
  const firstPage = await shownIds(ada);
  expect(tied.filter((href) => firstPage.includes(href))).toHaveLength(1);

  await ada.getByRole("link", { name: "Show older peels" }).click();
  await expect(ada).toHaveURL(/\?before=/);
  // 7 top-level peels and one repeel by now, plus the 25 above: 33 rows, so the
  // second page is the remaining 13 and there is nothing after it.
  await expect(ada.getByRole("article")).toHaveCount(13);
  await expect(card(ada, olderTitle(1))).toHaveCount(1);
  const secondPage = await shownIds(ada);
  expect(secondPage.filter((id) => firstPage.includes(id))).toEqual([]);
  // Both halves of the tie showed up, once each, across the two pages.
  expect([...firstPage, ...secondPage].filter((href) => tied.includes(href))).toHaveLength(2);
  await expect(ada.getByRole("link", { name: "Show older peels" })).toHaveCount(0);

  // Past the last row there is nothing left, and the copy says so.
  const oldest = `${new Date(start).toISOString()}_${await peelId(olderTitle(1))}`;
  await ada.goto(`/?before=${encodeURIComponent(oldest)}`);
  await expect(ada.getByRole("heading", { name: "That's all the peels." })).toBeVisible();
  await expect(ada.getByText("You've reached the end.")).toBeVisible();

  // A cursor from before ids were part of it is page one, not an error.
  await ada.goto(`/?before=${encodeURIComponent(new Date(start).toISOString())}`);
  await expect(ada.getByRole("article")).toHaveCount(20);

  // Bob's own peels page the same way.
  await ada.goto("/u/bob");
  await expect(ada.getByRole("article")).toHaveCount(20);
  await expect(ada.getByRole("link", { name: "Show older peels" })).toBeVisible();

  // Replies is the peels he hung off somebody else's, and nothing else.
  await ada.goto("/u/bob?tab=replies");
  await expect(ada.getByRole("article")).toHaveCount(1);
  await expect(card(ada, BOB_REPLY)).toHaveCount(1);

  // Likes is what he liked, newest like first -- ada's peel, from test 4.
  await ada.goto("/u/bob?tab=likes");
  await expect(ada.getByRole("article")).toHaveCount(1);
  await expect(card(ada, ADA_PEEL)).toHaveCount(1);

  // Ada liked and unliked her own peel in the MVP narrative, so hers is empty.
  await ada.goto("/u/ada?tab=likes");
  await expect(ada.getByRole("heading", { name: "No likes yet" })).toBeVisible();
  await expect(ada.getByText("Tap the wedge on a peel you like.")).toBeVisible();
});

test("9. new peels are announced, not slipped in under the reader", async ({ open }) => {
  const adaPeel = await peelId(ADA_PEEL);
  const ada = await open("ada");
  const feedListening = subscribed(ada);
  await ada.goto("/");
  await expect(ada.getByRole("article")).toHaveCount(20);
  await feedListening;

  await peelAs("bob", FRESH);
  await expect(ada.getByRole("button", { name: "1 new peel" })).toBeVisible({ timeout: 10_000 });
  await expect(card(ada, FRESH)).toHaveCount(0);

  // A reply is not on the timeline, so it is not announced on one. The peel
  // after it is what proves the count skipped it: two, not three.
  await peelAs("bob", "a reply nobody announced", adaPeel);
  await peelAs("bob", OTHER_FRESH);
  await expect(ada.getByRole("button", { name: "2 new peels" })).toBeVisible({ timeout: 10_000 });
  await expect(ada.getByRole("button", { name: "3 new peels" })).toHaveCount(0);

  await ada.getByRole("button", { name: "2 new peels" }).click();
  await expect(card(ada, FRESH)).toHaveCount(1);
  await expect(card(ada, OTHER_FRESH)).toHaveCount(1);
  await expect(ada.getByRole("button", { name: /new peels?$/ })).toHaveCount(0);

  // The same announcement, on a thread, counting only that thread's replies.
  const threadListening = subscribed(ada);
  await ada.goto(`/p/${adaPeel}`);
  await expect(ada.getByRole("button", { name: /new repl/ })).toHaveCount(0);
  await threadListening;
  await peelAs("bob", THREAD_REPLY, adaPeel);
  await expect(ada.getByRole("button", { name: "1 new reply" })).toBeVisible({ timeout: 10_000 });

  await ada.getByRole("button", { name: "1 new reply" }).click();
  await expect(card(ada, THREAD_REPLY)).toHaveCount(1);
});

test("10. with nobody followed, bob is offered somebody to follow", async ({ open }) => {
  const bobApi = await restAs("bob");
  const adaApi = await restAs("ada");
  // Suggestions are people you do not already follow, and bob follows ada.
  await bobApi.remove(`follows?follower_id=eq.${bobApi.id}&followee_id=eq.${adaApi.id}`);

  const bob = await open("bob");
  await bob.goto("/explore");
  const onExplore = bob.getByRole("heading", { name: "Who to follow" }).locator("..");
  await expect(onExplore.getByRole("link", { name: /Ada Lovelace/ })).toHaveAttribute(
    "href",
    "/u/ada",
  );

  await bob.goto("/?tab=following");
  const onFeed = bob.getByRole("heading", { name: "Who to follow" }).locator("..");
  await expect(onFeed.getByRole("link", { name: /Ada Lovelace/ })).toBeVisible();

  const follow = onFeed.getByRole("button", { name: "Follow", exact: true });
  const followed = actionWrite(bob);
  await follow.click();
  await expect(onFeed.getByRole("button", { name: "Following" })).toBeVisible();
  await followed;

  // The label alone is optimistic; her profile reads it back from the server.
  await bob.goto("/u/ada");
  await expect(bob.getByRole("button", { name: "Following" })).toBeVisible();
  // And she is no longer somebody to suggest.
  await bob.goto("/explore");
  await expect(bob.getByRole("link", { name: /Ada Lovelace/ })).toHaveCount(0);
});

test("11. a reply opens with the peels it answers above it, oldest first", async ({ open }) => {
  const rootId = await peelAs("ada", CHAIN_ROOT);
  const middleId = await peelAs("bob", CHAIN_MIDDLE, rootId);
  const leafId = await peelAs("ada", CHAIN_LEAF, middleId);

  const bob = await open("bob");
  await bob.goto(`/p/${leafId}`);

  // The conversation reads top to bottom and the opened peel is the last of it:
  // the ancestors are context, and the reply box under them belongs to the leaf.
  // Each card is identified by the peel its timestamp opens, not by its words.
  const chain = bob.getByRole("link", { name: "Open this peel" });
  await expect(chain).toHaveCount(3);
  await expect(chain.nth(0)).toHaveAttribute("href", `/p/${rootId}`);
  await expect(chain.nth(1)).toHaveAttribute("href", `/p/${middleId}`);
  await expect(chain.nth(2)).toHaveAttribute("href", `/p/${leafId}`);
  await expect(bob.getByLabel("Reply to @ada")).toBeVisible();

  await shot(bob, "thread-ancestors-mobile");

  // The root of the same conversation has nothing above it, and its own reply
  // still below it -- ancestors are not replies read upside down.
  await bob.goto(`/p/${rootId}`);
  const fromRoot = bob.getByRole("link", { name: "Open this peel" });
  await expect(fromRoot).toHaveCount(2);
  await expect(fromRoot.nth(0)).toHaveAttribute("href", `/p/${rootId}`);
  await expect(fromRoot.nth(1)).toHaveAttribute("href", `/p/${middleId}`);
});

test("12. every peel has a menu: copy the link, or hand it to the share sheet", async ({
  open,
}) => {
  const id = await peelAs("ada", SHAREABLE);
  const url = `${BASE_URL}/p/${id}`;

  // Whether a browser has a share sheet is a build detail of that browser, so
  // each half of this test states which kind it is standing in rather than
  // asking Chromium and hoping. First: one without.
  const bob = await open("bob");
  await bob.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await bob.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  });
  await bob.goto("/");

  // Somebody else's peel has the menu now. Copy link is the whole of it here:
  // no share sheet to offer, and nothing of his to delete.
  await peelCard(bob, id).getByRole("button", { name: "More" }).click();
  await expect(bob.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Share…" })).toHaveCount(0);
  await expect(bob.getByRole("button", { name: "Delete peel" })).toHaveCount(0);
  await bob.getByRole("button", { name: "Copy link" }).click();

  // What lands on the clipboard is the absolute link to that one peel,
  expect(await bob.evaluate(() => navigator.clipboard.readText())).toBe(url);
  // and the toast says so in the live region, then takes itself away again.
  await expect(bob.getByRole("status")).toHaveText("Link copied");
  await shot(bob, "toast-link-copied");
  await expect(bob.getByText("Link copied")).toHaveCount(0, { timeout: 6_000 });

  // Second: a browser with a sheet. The item appears, and is handed the peel.
  const phone = await open("bob");
  await phone.addInitScript(() => {
    window.shared = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: { title: string; url: string }) => {
        window.shared?.push(data);
        return Promise.resolve();
      },
    });
  });
  await phone.goto(`/p/${id}`);
  await peelCard(phone, id).getByRole("button", { name: "More" }).click();
  await phone.getByRole("button", { name: "Share…" }).click();
  expect(await phone.evaluate(() => window.shared)).toEqual([
    { title: "Ada Lovelace on Citrinia", url },
  ]);
  // Handing it over is not something to announce: the sheet is the feedback.
  await expect(phone.getByRole("status")).toBeEmpty();
});

test("13. followers and following are lists of their own, and they page", async ({ open }) => {
  const bobApi = await restAs("bob");
  const adaApi = await restAs("ada");

  // This test states its own ground rather than inheriting it, and states it
  // lopsided on purpose: ada follows bob and bob does not follow back, so the
  // two sides of the same profile cannot both be right by accident.
  await bobApi.remove(`follows?follower_id=eq.${bobApi.id}&followee_id=eq.${adaApi.id}`);
  await adaApi.remove(`follows?follower_id=eq.${adaApi.id}&followee_id=eq.${bobApi.id}`);
  await adaApi.insert("follows", { follower_id: adaApi.id, followee_id: bobApi.id });

  const bob = await open("bob");
  await bob.goto("/u/ada");

  // The count in the profile head is the way in, and it names the list it opens.
  await bob.getByRole("link", { name: "1 following" }).click();
  await expect(bob).toHaveURL(`${BASE_URL}/u/ada/following`);
  // By name, not by href: the navigation's own "You" points at /u/bob as well.
  await expect(bob.getByRole("link", { name: /@bob\b/ })).toBeVisible();
  // Nobody follows themselves: bob's own row offers him no button.
  await expect(bob.getByRole("button", { name: /^Follow(ing)?$/ })).toHaveCount(0);
  await shot(bob, "following-list");

  // The other side of the same profile is empty, and says so in ada's terms.
  await bob.getByRole("link", { name: "Followers" }).click();
  await expect(bob).toHaveURL(`${BASE_URL}/u/ada/followers`);
  await expect(bob.getByText("Nobody follows them yet.")).toBeVisible();

  const pips = await makeExtras(PIPS, "pip");
  try {
    // A page is 20, so 21 followers is one page and one straggler. pip01 and
    // pip02 are given the same instant, and it is the oldest -- which puts a tie
    // exactly on the boundary, where a cursor carrying only the time would step
    // over one of the pair and never show them.
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    await restAsService().insert(
      "follows",
      pips.map((pip, i) => ({
        follower_id: pip.id,
        followee_id: adaApi.id,
        created_at: new Date(start + Math.max(i, 1) * 60_000).toISOString(),
      })),
    );

    await bob.goto("/u/ada/followers");
    // The count first: `evaluateAll` reads whatever is there and does not wait.
    const rows = bob.locator('a[href^="/u/pip"]');
    await expect(rows).toHaveCount(20);
    const first = await pipHrefs(bob);
    // Newest follow first: pip21 followed last.
    expect(first[0]).toBe("/u/pip21");
    await shot(bob, "followers-list");

    await bob.getByRole("link", { name: "Show more people" }).click();
    await expect(bob).toHaveURL(/\?before=/);
    await expect(rows).toHaveCount(1);
    const second = await pipHrefs(bob);
    // The straggler is one of the tied pair, and which one is the id's business.
    expect(second[0]).toMatch(/^\/u\/pip0[12]$/);
    // One page and one straggler is the whole of it.
    await expect(bob.getByRole("link", { name: "Show more people" })).toHaveCount(0);

    // Nobody appears twice, and nobody fell down the gap between the two pages.
    expect(new Set([...first, ...second]).size).toBe(PIPS);

    // The button in a row is the real one: bob follows from the list, and it
    // shows up on his own following page.
    await bob.goto("/u/ada/followers");
    const row = bob.locator('a[href="/u/pip21"]').locator("..");
    const followed = actionWrite(bob);
    await row.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(row.getByRole("button", { name: "Following" })).toBeVisible();
    await followed;

    await bob.goto("/u/bob/following");
    await expect(bob.locator('a[href="/u/pip21"]')).toBeVisible();
  } finally {
    await removeExtras(pips.map((pip) => pip.id));
  }
});

test("14. bob's profile says where he is, where else to find him, and since when", async ({ open }) => {
  const bobApi = await restAs("bob");
  const bob = await open("bob");

  // This test states its own ground rather than inheriting it: the profile
  // fields are the one thing resetData() leaves alone, so a second run would
  // otherwise start with what the first one saved. "Joined" is given a date
  // today can never be mistaken for, because it must be the account's date.
  await restAsService().update(`profiles?id=eq.${bobApi.id}`, {
    created_at: "2024-01-15T00:00:00Z",
    location: "",
    website: "",
    banner_url: "",
  });

  const before = await listUploads(bobApi.id, "avatars");
  await bob.goto("/u/bob");
  const head = bob.getByRole("heading", { name: BOB, level: 1 }).locator("..");

  await bob.getByRole("button", { name: "Edit profile" }).click();
  const sheet = bob.getByRole("dialog");

  // A link that is not a link at all never reaches the column: the sheet says so
  // and stays open, and nothing else on the profile is saved behind it.
  await sheet.getByRole("textbox", { name: "Location" }).fill("Lisbon");
  const website = sheet.getByRole("textbox", { name: "Website" });
  await website.fill("javascript:alert(1)");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("A link has to start with https://")).toBeVisible();
  await expect(sheet).toBeVisible();
  await expect(head.getByText("Lisbon")).toHaveCount(0);

  // Typed without a scheme, the way people write an address down.
  await website.fill("citrinia.example");
  await sheet.getByLabel("Banner", { exact: true }).setInputFiles([
    { name: "banner.png", mimeType: "image/png", buffer: SQUARE },
  ]);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  await expect(head.getByText("Lisbon")).toBeVisible();
  // Shown without its scheme, but the href is the https url that was stored.
  const link = head.getByRole("link", { name: "citrinia.example" });
  await expect(link).toHaveAttribute("href", "https://citrinia.example");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(head.getByText("Joined January 2024")).toBeVisible();

  // The file went to the avatars bucket, into bob's own folder, and the banner
  // on the card is that object being served back.
  const uploaded = (await listUploads(bobApi.id, "avatars")).filter((path) => !before.includes(path));
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0].startsWith(`${bobApi.id}/`)).toBe(true);
  const bannerUrl = publicUrl(uploaded[0], "avatars");
  // `:visible`, because the edit sheet holds a preview of the same banner at the
  // same url and is rendered inside this very card whether it is open or not.
  const banner = bob.locator(`img[src="${bannerUrl}"]:visible`);
  await expect(banner).toBeVisible();
  expect((await bob.request.get(bannerUrl)).status()).toBe(200);
  await shot(bob, "profile-banner");

  // All of it survives a reload, because it is in the row and not in the sheet.
  await bob.reload();
  await expect(head.getByText("Lisbon")).toBeVisible();
  await expect(head.getByRole("link", { name: "citrinia.example" })).toBeVisible();
  await expect(banner).toBeVisible();

  // Taking the banner down clears the column and drops the object with it.
  await bob.getByRole("button", { name: "Edit profile" }).click();
  await sheet.getByRole("button", { name: "Remove banner" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => listUploads(bobApi.id, "avatars")).toEqual(before);
});

const PIN_FIRST = "the peel worth leading with";
const PIN_SECOND = "no, this one is better";
const NO_PICTURE = "just words, no picture";
const WITH_PICTURE = "words and a picture";

test("15. ada leads her profile with one peel, and only ever her own", async ({ open }) => {
  const adaApi = await restAs("ada");
  const bobApi = await restAs("bob");
  const service = restAsService();

  // Own ground: two peels of ada's and nothing pinned, whatever ran before.
  await service.update(`profiles?id=eq.${adaApi.id}`, { pinned_peel_id: null });
  const [first] = await service.insert<{ id: string }>("peels", {
    title: PIN_FIRST,
    user_id: adaApi.id,
    parent_id: null,
  });
  await service.insert("peels", { title: PIN_SECOND, user_id: adaApi.id, parent_id: null });

  const ada = await open("ada");
  await ada.goto("/u/ada");
  await expect(ada.getByText("Pinned")).toHaveCount(0);

  // The pin lives in the peel's own menu.
  await card(ada, PIN_FIRST).getByRole("button", { name: "More" }).click();
  const pinning = actionWrite(ada);
  await ada.getByRole("button", { name: "Pin to profile" }).click();
  await pinning;

  // It leads the profile, says why it is out of order, and is not also down in
  // the list underneath: one card, not two.
  await expect(card(ada, PIN_FIRST).getByText("Pinned")).toBeVisible();
  await expect(card(ada, PIN_FIRST)).toHaveCount(1);
  await shot(ada, "profile-pinned");

  // A profile leads with one peel, so pinning another replaces it rather than
  // collecting them.
  await card(ada, PIN_SECOND).getByRole("button", { name: "More" }).click();
  const repinning = actionWrite(ada);
  await ada.getByRole("button", { name: "Pin to profile" }).click();
  await repinning;
  await expect(card(ada, PIN_SECOND).getByText("Pinned")).toBeVisible();
  await expect(ada.getByText("Pinned")).toHaveCount(1);

  // The card that is pinned is the only one offering to undo it.
  await card(ada, PIN_SECOND).getByRole("button", { name: "More" }).click();
  const unpinning = actionWrite(ada);
  await ada.getByRole("button", { name: "Unpin from profile" }).click();
  await unpinning;
  await expect(ada.getByText("Pinned")).toHaveCount(0);
  // Unpinned, it is back in the list rather than gone from the profile.
  await expect(card(ada, PIN_SECOND)).toHaveCount(1);

  // The pin only reaches your own peels, and the database is what says so --
  // this goes straight at PostgREST, past the app entirely.
  await expect(
    bobApi.update(`profiles?id=eq.${bobApi.id}`, { pinned_peel_id: first.id }),
  ).rejects.toThrow(/pinned peel must be one of your own/);
  const [bobRow] = await service.select<{ pinned_peel_id: string | null }>(
    `profiles?id=eq.${bobApi.id}&select=pinned_peel_id`,
  );
  expect(bobRow.pinned_peel_id).toBeNull();
});

test("16. the Media tab is the peels with something on them", async ({ open }) => {
  const bobApi = await restAs("bob");
  const service = restAsService();

  // Own ground: one peel of bob's with a picture, one without.
  const [plain] = await service.insert<{ id: string }>("peels", {
    title: NO_PICTURE,
    user_id: bobApi.id,
    parent_id: null,
  });
  const [illustrated] = await service.insert<{ id: string }>("peels", {
    title: WITH_PICTURE,
    user_id: bobApi.id,
    parent_id: null,
  });
  await service.insert("peel_media", {
    peel_id: illustrated.id,
    position: 0,
    kind: "image",
    url: REMOTE_IMAGE,
    alt: "orange square",
    width: 64,
    height: 64,
  });

  const bob = await open("bob");
  await bob.goto("/u/bob");
  // Peels is everything he wrote, picture or not.
  await expect(card(bob, WITH_PICTURE)).toHaveCount(1);
  await expect(card(bob, NO_PICTURE)).toHaveCount(1);

  await bob.getByRole("link", { name: "Media", exact: true }).click();
  await expect(bob).toHaveURL(`${BASE_URL}/u/bob?tab=media`);
  await expect(card(bob, WITH_PICTURE)).toHaveCount(1);
  await expect(card(bob, WITH_PICTURE).getByRole("img", { name: "orange square" })).toBeVisible();
  // The whole point of the tab: the peel with nothing on it is not here.
  await expect(card(bob, NO_PICTURE)).toHaveCount(0);
  await shot(bob, "profile-media-tab");

  // Somebody with nothing to show gets the tab's own empty state, not the
  // profile's, and it is worded for a visitor rather than for the owner.
  await service.remove(`peel_media?peel_id=eq.${illustrated.id}`);
  await bob.goto("/u/bob?tab=media");
  await expect(bob.getByText("No pictures yet")).toBeVisible();
  await expect(bob.getByText("Attach one to a peel and it turns up here.")).toBeVisible();

  await service.remove(`peels?id=in.(${plain.id},${illustrated.id})`);
});

test("17. ada changes her handle, and the old one still finds her", async ({ open }) => {
  const adaApi = await restAs("ada");
  const service = restAsService();

  // Own ground: ada is @ada and has let go of nothing, whatever ran before.
  await service.update(`profiles?id=eq.${adaApi.id}`, { username: "ada" });
  await service.remove(`username_history?profile_id=eq.${adaApi.id}`);

  const ada = await open("ada");
  // All of it inside a try: a rename left in place would greet the next run as
  // a missing account, and the suite would not get as far as its first test.
  try {
    await ada.goto("/u/ada");
    await ada.getByRole("button", { name: "Edit profile" }).click();
    const sheet = ada.getByRole("dialog");
    const handle = sheet.getByRole("textbox", { name: "Handle" });
    const save = sheet.getByRole("button", { name: "Save" });

    // A handle no mention could match never reaches the database.
    await handle.fill("no");
    await save.click();
    await expect(sheet.getByText("A handle is 3 to 20 characters.")).toBeVisible();
    await expect(sheet).toBeVisible();

    // One somebody is using is refused by the database, which is the only thing
    // that can know: the check and the taking have to be the same statement.
    await handle.fill("bob");
    await save.click();
    await expect(sheet.getByText("That handle is taken.")).toBeVisible();

    // Typed with capitals, stored lower case, because that is what a mention of
    // it will go looking for.
    await handle.fill("Ada_Lovelace");
    await save.click();
    await expect(sheet).toBeHidden();
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada_lovelace`);
    // Scoped to the profile head: the new handle is on every card she wrote,
    // and in the sheet's own note about it.
    await expect(
      ada.getByRole("heading", { level: 1 }).locator("..").getByText("@ada_lovelace"),
    ).toBeVisible();

    // Every link ever written to the old handle still arrives -- the profile,
    // the tab somebody linked, and the lists hanging off it.
    await ada.goto("/u/ada");
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada_lovelace`);
    await ada.goto("/u/ada?tab=likes");
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada_lovelace?tab=likes`);
    await ada.goto("/u/ada/followers");
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada_lovelace/followers`);

    // Nobody else may take what she has only just let go of.
    const bob = await open("bob");
    await bob.goto("/u/bob");
    await bob.getByRole("button", { name: "Edit profile" }).click();
    const bobSheet = bob.getByRole("dialog");
    await bobSheet.getByRole("textbox", { name: "Handle" }).fill("ada");
    await bobSheet.getByRole("button", { name: "Save" }).click();
    await expect(bobSheet.getByText(/on hold for another \d+ day/)).toBeVisible();
    // Refused whole: bob is still bob.
    await expect(bob).toHaveURL(`${BASE_URL}/u/bob`);

    // The hold never applies to the person who left it, so ada can undo all of
    // this -- and once she has, the handle she borrowed forwards back.
    await ada.goto("/u/ada_lovelace");
    await ada.getByRole("button", { name: "Edit profile" }).click();
    await sheet.getByRole("textbox", { name: "Handle" }).fill("ada");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada`);
    await ada.goto("/u/ada_lovelace");
    await expect(ada).toHaveURL(`${BASE_URL}/u/ada`);
  } finally {
    await service.update(`profiles?id=eq.${adaApi.id}`, { username: "ada" });
    await service.remove(`username_history?profile_id=eq.${adaApi.id}`);
  }
});

test("18. bob reports a peel and a person, and saying it twice still lands once", async ({
  open,
}) => {
  // Its own ground: one peel of ada's to flag, and no reports of bob's on file.
  const id = await peelAs("ada", REPORTABLE);
  const bobApi = await restAs("bob");
  const adaApi = await restAs("ada");
  const service = restAsService();
  await service.remove(`reports?reporter_id=eq.${bobApi.id}`);

  const bob = await open("bob");
  await bob.goto("/");

  // Report is on somebody else's peel and not on your own -- there is nothing
  // to tell us about a peel you can simply delete.
  const ownPeel = await peelAs("bob", BOB_OWN);
  await bob.reload();
  await peelCard(bob, ownPeel).getByRole("button", { name: "More" }).click();
  await expect(bob.getByRole("button", { name: "Report peel" })).toHaveCount(0);
  await bob.keyboard.press("Escape");

  await peelCard(bob, id).getByRole("button", { name: "More" }).click();
  await bob.getByRole("button", { name: "Report peel" }).click();

  const sheet = bob.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Report this peel" })).toBeVisible();

  // Nothing is picked for you, because a report is a thing somebody says.
  const send = sheet.getByRole("button", { name: "Send report" });
  await expect(send).toBeDisabled();

  await sheet.getByRole("radio", { name: /Abuse/ }).check();
  await expect(send).toBeEnabled();
  await sheet.getByRole("textbox", { name: "Anything to add?" }).fill("  keeps\n\nsaying it  ");
  await send.click();

  await expect(sheet).toBeHidden();
  await expect(bob.getByRole("status")).toHaveText("Thanks, we'll take a look");

  // The row is bob's, about that peel, with the reason he picked and the note
  // as one line. Read with the service role, because nothing else can read it.
  const filed = await service.select<{
    reporter_id: string;
    peel_id: string | null;
    profile_id: string | null;
    reason: string;
    note: string;
  }>(`reports?reporter_id=eq.${bobApi.id}&select=reporter_id,peel_id,profile_id,reason,note`);
  expect(filed).toEqual([
    {
      reporter_id: bobApi.id,
      peel_id: id,
      profile_id: null,
      reason: "abuse",
      note: "keeps saying it",
    },
  ]);

  // Saying it again is not a failure and is not a second row: he is thanked and
  // the queue stays as it was.
  await peelCard(bob, id).getByRole("button", { name: "More" }).click();
  await bob.getByRole("button", { name: "Report peel" }).click();
  await sheet.getByRole("radio", { name: /Spam/ }).check();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet).toBeHidden();
  await expect(bob.getByRole("status")).toHaveText("Thanks, we'll take a look");
  expect(
    await service.select<{ reason: string }>(
      `reports?reporter_id=eq.${bobApi.id}&peel_id=eq.${id}&select=reason`,
    ),
  ).toEqual([{ reason: "abuse" }]);

  // The person, from the same sheet on their profile -- a different subject, so
  // a row of its own.
  await bob.goto("/u/ada");
  await bob.getByRole("button", { name: "More for @ada" }).click();
  await bob.getByRole("button", { name: "Report @ada" }).click();
  await expect(sheet.getByRole("heading", { name: "Report @ada" })).toBeVisible();
  await sheet.getByRole("radio", { name: /Spam/ }).check();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(bob.getByRole("status")).toHaveText("Thanks, we'll take a look");
  expect(
    await service.select<{ profile_id: string; reason: string; note: string }>(
      `reports?reporter_id=eq.${bobApi.id}&profile_id=eq.${adaApi.id}&select=profile_id,reason,note`,
    ),
  ).toEqual([{ profile_id: adaApi.id, reason: "spam", note: "" }]);

  // Your own profile has no dots at all: there is nobody to report.
  const ada = await open("ada");
  await ada.goto("/u/ada");
  await expect(ada.getByRole("button", { name: /^More for @/ })).toHaveCount(0);

  // The queue is not something a signed-in reader can read back, whoever they are.
  await expect(bobApi.select("reports?select=id")).rejects.toThrow(/40[13]/);

  await service.remove(`reports?reporter_id=eq.${bobApi.id}`);
});

test("19. an account can be closed from settings, and it takes its peels with it", async ({
  open,
}) => {
  const guest = await makeGuest("leaver");
  const service = restAsService();

  try {
    const guestApi = await restAsGuest(guest);
    await guestApi.insert("peels", { title: LEAVING, user_id: guestApi.id });

    // Ada can see them, and their peel, before any of this.
    const ada = await open("ada");
    await ada.goto("/");
    await expect(card(ada, LEAVING)).toBeVisible();

    const leaver = await open(guest);
    await leaver.goto("/settings");

    // What the page holds today: the handle, the muted list, the theme, and the
    // way out. Email, password and blocked arrive with the slices that own them.
    await expect(leaver.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(leaver.getByRole("link", { name: /Username @leaver/ })).toHaveAttribute(
      "href",
      "/u/leaver",
    );
    await expect(leaver.getByRole("link", { name: "Muted" })).toHaveAttribute(
      "href",
      "/settings/muted",
    );
    await expect(leaver.getByRole("group", { name: "Theme" })).toBeVisible();

    await leaver.getByRole("button", { name: "Delete account" }).click();
    const dialog = leaver.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete your account?" })).toBeVisible();

    // Nothing happens until the handle is typed, and somebody else's will not do.
    const confirm = dialog.getByRole("textbox", { name: "Your handle" });
    const destroy = dialog.getByRole("button", { name: "Delete everything" });
    await expect(destroy).toBeDisabled();
    await confirm.fill("ada");
    await expect(destroy).toBeDisabled();
    await confirm.fill("leave");
    await expect(destroy).toBeDisabled();

    // Their own, as people type it: the @ they did not mean and the case they did.
    await confirm.fill("@Leaver");
    await expect(destroy).toBeEnabled();
    await destroy.click();

    // The session ends where a session with no account has to end.
    await expect(leaver).toHaveURL(`${BASE_URL}/login`);

    // The account, the profile and the peel are gone, for them and for everyone.
    expect(
      await service.select<{ id: string }>(`profiles?id=eq.${guest.id}&select=id`),
    ).toEqual([]);
    await ada.reload();
    await expect(card(ada, LEAVING)).toHaveCount(0);
    await ada.goto("/u/leaver");
    await expect(ada.getByRole("heading", { name: "That peel got composted." })).toBeVisible();
  } finally {
    await removeExtras([guest.id]);
  }
});

test("20. bob mutes ada: she leaves his feed, his replies and his bell, but not her own profile", async ({
  open,
}) => {
  // Its own ground: no mute of bob's on file, and a thread of his for ada to
  // answer into. Everything asserted below is about rows made inside this test.
  const bobApi = await restAs("bob");
  const adaApi = await restAs("ada");
  const service = restAsService();
  await service.remove(`mutes?muter_id=eq.${bobApi.id}`);
  const thread = await peelAs("bob", BOB_THREAD);

  const bob = await open("bob");
  await bob.goto("/u/ada");
  await bob.getByRole("button", { name: "More for @ada" }).click();
  await bob.getByRole("button", { name: "Mute @ada" }).click();
  // The wording is the promise: it says what bob stops seeing, not that ada was
  // told anything -- because she was not.
  await expect(bob.getByRole("status")).toHaveText("You won't see @ada");

  // Everything ada does from here is quiet for bob and ordinary for everyone else.
  await peelAs("ada", MUTED_PEEL);
  await peelAs("ada", MUTED_REPLY, thread);

  // Her profile still reads in full. This is the whole line between muting
  // somebody and blocking them, so it is the first thing checked.
  await bob.reload();
  await expect(card(bob, MUTED_PEEL)).toBeVisible();
  await expect(bob.getByRole("button", { name: "Unmute @ada" })).toBeHidden();

  // The feed drops her, and keeps working.
  await bob.goto("/");
  await expect(card(bob, BOB_PEEL)).toBeVisible();
  await expect(card(bob, MUTED_PEEL)).toHaveCount(0);

  // So do the replies under his own peel -- for him. Not for anybody else.
  await bob.goto(`/p/${thread}`);
  await expect(card(bob, BOB_THREAD)).toBeVisible();
  await expect(card(bob, MUTED_REPLY)).toHaveCount(0);

  const ada = await open("ada");
  await ada.goto(`/p/${thread}`);
  await expect(card(ada, MUTED_REPLY)).toBeVisible();

  // Search drops her peels but People still finds her, which is how he reaches
  // the profile to undo it. The person row is named in full: a bare "@ada" also
  // matches the mention link inside somebody's peel, which is a different link.
  await bob.goto("/explore?q=marmalade");
  await expect(card(bob, MUTED_PEEL)).toHaveCount(0);
  await bob.goto("/explore?q=ada&tab=people");
  await expect(bob.getByRole("link", { name: "Ada Lovelace @ada" })).toBeVisible();

  // The bell says nothing. Everything bob already had from ada is cleared first,
  // so what is counted afterwards is only what she does from here.
  await service.remove(`notifications?user_id=eq.${bobApi.id}&actor_id=eq.${adaApi.id}`);
  const quiet = await peelAs("bob", "something for ada to answer quietly");
  await adaApi.insert("likes", { peel_id: quiet, user_id: adaApi.id });
  await adaApi.insert("peels", { title: "a quiet reply", user_id: adaApi.id, parent_id: quiet });
  await adaApi.insert("peels", { title: "quietly at @bob", user_id: adaApi.id });
  expect(
    await service.select<{ type: string }>(
      `notifications?user_id=eq.${bobApi.id}&actor_id=eq.${adaApi.id}&select=type`,
    ),
  ).toEqual([]);

  // Settings lists her, and the button there is the way back.
  await bob.goto("/settings");
  await bob.getByRole("link", { name: "Muted" }).click();
  await expect(bob.getByRole("heading", { name: "Muted", level: 1 })).toBeVisible();
  await expect(bob.getByRole("link", { name: "Ada Lovelace @ada" })).toBeVisible();

  await bob.getByRole("button", { name: "Unmute @ada" }).click();
  await expect(bob.getByRole("status")).toHaveText("You'll see @ada again");
  await expect(bob.getByRole("link", { name: "Ada Lovelace @ada" })).toHaveCount(0);
  await expect(bob.getByRole("heading", { name: "Nobody muted" })).toBeVisible();

  // And she is back, everywhere she left.
  await bob.goto("/");
  await expect(card(bob, MUTED_PEEL)).toBeVisible();
  await bob.goto(`/p/${thread}`);
  await expect(card(bob, MUTED_REPLY)).toBeVisible();

  // The control the silence above needs: the same act, now that she is unmuted,
  // does ring. Without this, a bell that was simply broken would have passed.
  const loud = await peelAs("bob", "something for ada to answer out loud");
  await adaApi.insert("likes", { peel_id: loud, user_id: adaApi.id });
  await expect
    .poll(async () =>
      (
        await service.select<{ type: string }>(
          `notifications?user_id=eq.${bobApi.id}&actor_id=eq.${adaApi.id}&select=type`,
        )
      ).map((row) => row.type),
    )
    .toEqual(["like"]);
});

test("21. bob blocks carol: she is told, the follows go, and neither can reach the other", async ({
  open,
}) => {
  const carol = await makeGuest("carol");
  const service = restAsService();

  try {
    const bobApi = await restAs("bob");
    const carolApi = await restAsGuest(carol);

    // Before: they follow each other and each can read the other's peels.
    const bobPeel = await peelAs("bob", BOB_BEFORE_BLOCK);
    await carolApi.insert("peels", { title: CAROL_PEEL, user_id: carolApi.id });
    await carolApi.insert("follows", { follower_id: carolApi.id, followee_id: bobApi.id });
    await bobApi.insert("follows", { follower_id: bobApi.id, followee_id: carolApi.id });

    const bob = await open("bob");
    await bob.goto("/");
    await expect(card(bob, CAROL_PEEL)).toBeVisible();

    // Blocking is the one thing here that asks first, because it changes what
    // somebody else can see and unblocking does not put the follows back.
    await bob.goto("/u/carol");
    await bob.getByRole("button", { name: "More for @carol" }).click();
    await bob.getByRole("button", { name: "Block @carol" }).click();
    const confirm = bob.getByRole("dialog");
    await expect(confirm.getByRole("heading", { name: "Block @carol?" })).toBeVisible();
    await expect(confirm.getByText(/unblocking later does not undo that/)).toBeVisible();
    await confirm.getByRole("button", { name: "Block @carol" }).click();
    await expect(bob.getByRole("status")).toHaveText("@carol is blocked");

    // His side: the notice stands where her peels were, and the button that
    // undoes it stands where Follow was.
    await expect(bob.getByText("You blocked @carol")).toBeVisible();
    await expect(bob.getByRole("button", { name: "Unblock" })).toBeVisible();
    await expect(card(bob, CAROL_PEEL)).toHaveCount(0);
    // Not "no peels yet" -- she has peels, and saying otherwise would be a lie.
    await expect(bob.getByRole("link", { name: "Peels" })).toHaveCount(0);
    await bob.goto("/");
    await expect(card(bob, CAROL_PEEL)).toHaveCount(0);

    // Her side. She is told, which is the whole difference from a mute.
    const she = await open(carol);
    await she.goto("/u/bob");
    await expect(she.getByText("@bob has blocked you")).toBeVisible();
    await expect(she.getByRole("button", { name: "Follow" })).toHaveCount(0);
    await expect(card(she, BOB_BEFORE_BLOCK)).toHaveCount(0);
    await she.goto("/");
    await expect(card(she, BOB_BEFORE_BLOCK)).toHaveCount(0);

    // She cannot reach the peel at all, so there is nothing to reply to: the
    // policy hides the row, and the page has no peel to render.
    await she.goto(`/p/${bobPeel}`);
    await expect(she.getByRole("heading", { name: "That peel got composted." })).toBeVisible();

    // Both follows went, and neither of them had to ask for that.
    expect(
      await service.select<{ follower_id: string }>(
        `follows?or=(and(follower_id.eq.${bobApi.id},followee_id.eq.${carolApi.id}),and(follower_id.eq.${carolApi.id},followee_id.eq.${bobApi.id}))&select=follower_id`,
      ),
    ).toEqual([]);

    // Nor can she put one back, whatever her client thinks.
    await expect(
      carolApi.insert("follows", { follower_id: carolApi.id, followee_id: bobApi.id }),
    ).rejects.toThrow(/40[13]/);

    // Settings lists her, and unblocking gives the peels back -- and only those.
    await bob.goto("/settings");
    await bob.getByRole("link", { name: "Blocked" }).click();
    await expect(bob.getByRole("heading", { name: "Blocked", level: 1 })).toBeVisible();
    await expect(bob.getByRole("link", { name: /@carol\b/ })).toBeVisible();
    await bob.getByRole("button", { name: "Unblock" }).click();
    await expect(bob.getByRole("status")).toHaveText("@carol is unblocked");
    await expect(bob.getByRole("heading", { name: "Nobody blocked" })).toBeVisible();

    await bob.goto("/");
    await expect(card(bob, CAROL_PEEL)).toBeVisible();
    expect(
      await service.select<{ follower_id: string }>(
        `follows?or=(and(follower_id.eq.${bobApi.id},followee_id.eq.${carolApi.id}),and(follower_id.eq.${carolApi.id},followee_id.eq.${bobApi.id}))&select=follower_id`,
      ),
    ).toEqual([]);
  } finally {
    await removeExtras([carol.id]);
  }
});


test("22. explore leads with what the day is talking about", async ({ open }) => {
  // Three throwaway people so a tag can actually spread; the ranking rule is
  // about how many of them used it, which two accounts cannot show.
  const zesty = await makeExtras(3, "zest");
  const service = restAsService();
  try {
    const tagged: string[] = [];
    for (const person of zesty) {
      const [row] = await service.insert<{ id: string }>("peels", {
        title: `${ZEST} #zest, said ${person.username}`,
        user_id: person.id,
      });
      tagged.push(row.id);
    }
    // Says the word, carries a different tag. A search for #zest must not find
    // it; a search for the bare word must.
    await service.insert("peels", { title: `${ZEST} #zestfest`, user_id: zesty[1].id });
    // The same tag three times from one of them. Volume, not reach.
    for (let n = 1; n <= 3; n++) {
      await service.insert("peels", { title: `${LOUD} #loud (${n})`, user_id: zesty[0].id });
    }
    // The oldest of the three is the one people answered, so Top and Latest
    // cannot agree: whichever order they share would mean one of them is broken.
    for (const person of zesty.slice(1)) {
      await service.insert("likes", { peel_id: tagged[0], user_id: person.id });
    }

    const bob = await open("bob");

    // Every link ever shared out of the old screen still lands, query and all.
    await bob.goto("/search?q=%23zest");
    await expect(bob).toHaveURL(`${BASE_URL}/explore?q=%23zest`);

    await bob.goto("/explore");
    const trends = bob.getByRole("heading", { name: "Trending today" }).locator("..");
    await expect(trends.getByRole("link", { name: /^#zest\b/ })).toContainText(
      "3 peels from 3 people",
    );
    await expect(trends.getByRole("link", { name: /^#loud\b/ })).toContainText(
      "3 peels from 1 person",
    );

    // Reach beats volume: the tag three people used sits above the tag one
    // person used three times. Positions, because the numbers alone would pass
    // with the two rows in either order.
    const order = await trends.getByRole("link").allInnerTexts();
    const zest = order.findIndex((row) => row.startsWith("#zest"));
    const loud = order.findIndex((row) => row.startsWith("#loud"));
    expect(zest, "#zest is listed").toBeGreaterThanOrEqual(0);
    expect(zest, "a tag three people used outranks a tag one person used three times").toBeLessThan(
      loud,
    );

    // The row is the way in to the tag's own results, which open on Top.
    await trends.getByRole("link", { name: /^#zest\b/ }).click();
    await expect(bob).toHaveURL(`${BASE_URL}/explore?q=%23zest`);
    await expect(bob.getByRole("link", { name: "Top" })).toHaveAttribute("aria-current", "page");

    // All three, and only those: a hashtag matches a whole tag, so the peel
    // that says "zest" under #zestfest is not one of them.
    await expect(card(bob, ZEST)).toHaveCount(3);
    await expect(card(bob, "#zestfest")).toHaveCount(0);
    // Top leads with the one people answered, not the newest.
    await expect(bob.getByRole("article").first()).toContainText("said zest01");

    await bob.getByRole("link", { name: "Latest" }).click();
    await expect(bob).toHaveURL(`${BASE_URL}/explore?q=%23zest&tab=latest`);
    await expect(card(bob, ZEST)).toHaveCount(3);
    await expect(bob.getByRole("article").first()).toContainText("said zest03");

    // The same word without the sigil is an ordinary search, so it reaches the
    // other tag too -- the two are different questions and answer differently.
    await bob.goto("/explore?q=zest");
    await expect(card(bob, "#zestfest")).toHaveCount(1);

    // And the people behind the word are one tab away, with a way to follow them.
    await bob.getByRole("link", { name: "People" }).click();
    await expect(bob.getByRole("link", { name: "Pip 01 @zest01" })).toBeVisible();
    await expect(bob.getByRole("button", { name: "Follow", exact: true })).toHaveCount(3);
    await expect(card(bob, ZEST)).toHaveCount(0);
  } finally {
    await removeExtras(zesty.map((person) => person.id));
  }
});

test("23. a link in a peel gets a card, fetched once and drawn from the url", async ({ open }) => {
  const linked = `the notes are here ${OG_ORIGIN}/og`;
  const bare = `and this one says nothing about itself ${OG_ORIGIN}/bare`;
  const shared = `worth reading twice ${OG_ORIGIN}/og`;

  const ada = await open("ada");
  await ada.goto("/");
  await ada.getByRole("button", { name: "New peel", exact: true }).click();
  await ada.getByRole("textbox", { name: "Your peel" }).fill(linked);
  let posted = actionWrite(ada);
  await ada.getByRole("button", { name: "Peel it" }).click();
  await posted;

  const peel = card(ada, linked);
  await expect(peel).toHaveCount(1);

  // The url in the body is a link now, and it leaves the app rather than routing.
  const inBody = peel.getByRole("link", { name: `${OG_ORIGIN}/og` });
  await expect(inBody).toHaveAttribute("href", `${OG_ORIGIN}/og`);
  await expect(inBody).toHaveAttribute("target", "_blank");

  // The card under it is what the page said about itself -- except the site
  // line and the href, which are read off the url and cannot be forged.
  const preview = peel.getByRole("link", { name: new RegExp(OG_TITLE) });
  await expect(preview).toHaveAttribute("href", `${OG_ORIGIN}/og`);
  await expect(preview).toContainText("127.0.0.1");
  await expect(preview).toContainText(OG_DESCRIPTION);
  await expect(preview.locator("img")).toHaveAttribute("src", `${OG_ORIGIN}/card.svg`);
  expect(ogFetches, "the page was read once").toBe(1);

  // A page with no Open Graph tags gives the compact row: its own title, and
  // no picture above it.
  await ada.getByRole("button", { name: "New peel", exact: true }).click();
  await ada.getByRole("textbox", { name: "Your peel" }).fill(bare);
  posted = actionWrite(ada);
  await ada.getByRole("button", { name: "Peel it" }).click();
  await posted;

  const compact = card(ada, bare).getByRole("link", { name: new RegExp(BARE_TITLE) });
  await expect(compact).toContainText("127.0.0.1");
  await expect(compact.locator("img")).toHaveCount(0);

  // Somebody else shares the same link: the same card, and nobody knocks on the
  // page a second time. That is the whole point of keying the table on the url.
  const bob = await open("bob");
  await bob.goto("/");
  await bob.getByRole("button", { name: "New peel", exact: true }).click();
  await bob.getByRole("textbox", { name: "Your peel" }).fill(shared);
  posted = actionWrite(bob);
  await bob.getByRole("button", { name: "Peel it" }).click();
  await posted;

  await expect(card(bob, shared).getByRole("link", { name: new RegExp(OG_TITLE) })).toBeVisible();
  expect(ogFetches, "a link shared twice is fetched once").toBe(1);
});

test("24. ada peels a thread, and it lands as one chain in the order she wrote it", async ({
  open,
}) => {
  const one = "a thread about marmalade, part one";
  const two = "part two: the setting point is a lie";
  const three = "part three: it sets when it feels like it";

  const ada = await open("ada");
  await ada.goto("/");
  await ada.getByRole("button", { name: "New peel", exact: true }).click();

  // One box to start with, and the button offers to post one peel.
  const sheet = ada.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Peel it" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Your peel" }).fill(one);

  await sheet.getByRole("button", { name: "Add another" }).click();
  await sheet.getByRole("textbox", { name: "Peel 2" }).fill(two);

  // Each box counts its own characters. The second box is not told how much
  // room the first one used, because it is a different peel.
  await expect(sheet.getByText(`${280 - one.length} left`)).toBeVisible();
  await expect(sheet.getByText(`${280 - two.length} left`)).toBeVisible();

  // A box with nothing in it is not a peel, so the whole thread waits.
  await sheet.getByRole("button", { name: "Add another" }).click();
  const post = sheet.getByRole("button", { name: "Peel all" });
  await expect(post).toBeDisabled();
  await sheet.getByRole("textbox", { name: "Peel 3" }).fill(three);
  await expect(post).toBeEnabled();

  const posted = actionWrite(ada);
  await post.click();
  await posted;

  // The feed shows the first peel and only the first: the other two are replies
  // to it, and replies do not sit at the top level.
  await expect(card(ada, one)).toHaveCount(1);
  await expect(card(ada, two)).toHaveCount(0);
  await expect(card(ada, three)).toHaveCount(0);

  // The chain, from the middle of it: part one above, part three below, and the
  // one she opened between them. Reading the ancestors is slice 1's walk, so
  // this is also proof the parent_ids really do point back up the thread.
  await card(ada, one).getByRole("link", { name: "Open this peel" }).click();
  await expect(ada.getByRole("article").filter({ hasText: two })).toHaveCount(1);
  await ada.getByRole("article").filter({ hasText: two }).getByRole("link", { name: "Open this peel" }).click();

  const chain = ada.getByRole("article");
  await expect(chain).toHaveCount(3);
  await expect(chain.nth(0)).toContainText(one);
  await expect(chain.nth(1)).toContainText(two);
  await expect(chain.nth(2)).toContainText(three);

  await shot(ada, "thread-composed-mobile");
});

test("25. the composer offers people after @, and the one ada picks gets the bell", async ({
  open,
}) => {
  const ada = await open("ada");

  // The box looks people up from the browser, so the requests it makes are
  // countable -- which is the only way to tell "the list did not open" from
  // "the list had not opened yet".
  let lookups = 0;
  ada.on("request", (request) => {
    const url = request.url();
    if (url.includes("/rest/v1/profiles") && url.includes("imatch")) lookups += 1;
  });

  await ada.goto("/");
  await ada.getByRole("button", { name: "New peel", exact: true }).click();

  const sheet = ada.getByRole("dialog");
  const written = sheet.getByRole("textbox", { name: "Your peel" });
  const list = sheet.getByRole("listbox", { name: "People to mention" });

  // One character after the @ is not enough to ask about: it would be a list of
  // everybody. Given longer than the whole lookup takes when there is one, so
  // this says nobody asked rather than that nobody had answered yet.
  await written.fill("morning @b");
  await ada.waitForTimeout(600);
  expect(lookups, "one character after @ asks nobody").toBe(0);
  await expect(list).toHaveCount(0);

  // Two is. The row names the person, not just the handle.
  await written.fill("morning @bo");
  await expect(list).toBeVisible();
  expect(lookups, "two characters ask once").toBe(1);
  const option = list.getByRole("option");
  await expect(option.filter({ hasText: "@bob" })).toHaveCount(1);
  await expect(option.first()).toContainText(BOB);

  // Escape puts it away without closing the sheet or losing the words.
  await written.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(written).toHaveValue("morning @bo");

  // Typing on brings it back, and Enter takes whichever row is highlighted.
  await written.fill("morning @bob");
  await expect(list).toBeVisible();
  await written.press("Enter");
  await expect(list).toHaveCount(0);
  // The handle is complete and there is room for the next word after it.
  await expect(written).toHaveValue("morning @bob ");

  const mention = `morning @bob, the marmalade set ${Date.now()}`;
  await written.fill(mention);
  const posted = actionWrite(ada);
  await sheet.getByRole("button", { name: "Peel it" }).click();
  await posted;

  // A handle that came from the list is a handle like any other: the trigger
  // reads the text, so bob hears about it the same way he would have anyway.
  const bob = await open("bob");
  await bob.goto("/notifications");
  const rang = bob.getByRole("link").filter({ hasText: "mentioned you" });
  await expect(rang).toHaveCount(1);
  await expect(rang).toContainText(mention);
});

// Slice 11: messages.
/** Ada's row in bob's list: her name, so it cannot match the navigation. */
const BOB_ROW_MATCH = "Ada Lovelace";
const ADA_HELLO = "bob, are you awake";
const BOB_ANSWER = "wide awake, ada";

test("26. ada writes to bob from his profile, and his answer arrives without a reload", async ({
  open,
}) => {
  // Its own ground. Tests 10 and 13 both take the bob -> ada follow away, and
  // whether the recipient follows the sender is exactly what decides between an
  // ordinary conversation and a request -- so this one puts it back rather than
  // inheriting whatever the run before it left. (Requests are test 27's subject.)
  const bobApi = await restAs("bob");
  const adaApi = await restAs("ada");
  await bobApi.remove(`follows?follower_id=eq.${bobApi.id}&followee_id=eq.${adaApi.id}`);
  await bobApi.insert("follows", { follower_id: bobApi.id, followee_id: adaApi.id });

  const ada = await open("ada");
  const bob = await open("bob");

  // Nothing has been said yet, so bob has no inbox at all.
  await bob.goto("/messages");
  await expect(bob.getByText("No messages yet")).toBeVisible();

  // The way in is the button on his profile.
  await ada.goto("/u/bob");
  // `exact`, or it also matches the bar's own "Messages" -- the trap mvp test 6
  // set for @ada and the rail.
  await ada.getByRole("link", { name: "Message", exact: true }).click();
  await expect(ada).toHaveURL(`${BASE_URL}/messages/with/bob`);
  await expect(ada.getByText(`This is the start of your conversation with ${BOB}`)).toBeVisible();

  // Opening a conversation is not starting one: the row is written by the first
  // message and by nothing else.
  await bob.reload();
  await expect(bob.getByText("No messages yet")).toBeVisible();

  // A conversation owns the bottom edge of a phone, so the bar stands aside and
  // the way back is the arrow in the head.
  await expect(ada.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(ada.getByRole("link", { name: "Back to messages" })).toBeVisible();

  const box = ada.getByRole("textbox", { name: "Message @bob" });
  await box.fill(ADA_HELLO);
  await ada.getByRole("button", { name: "Send" }).click();

  // Sent: the words are on the screen, the box is empty again, and the url has
  // become the conversation the message just made.
  await expect(ada.getByText(ADA_HELLO)).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(ada).toHaveURL(new RegExp(`^${BASE_URL}/messages/[0-9a-f-]{36}$`));

  // Bob follows ada, so it is an ordinary conversation rather than a request:
  // straight into his list, with the preview and a dot on it.
  await bob.reload();
  const row = bob.getByRole("link").filter({ hasText: BOB_ROW_MATCH });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(ADA_HELLO);
  await expect(bob.getByRole("img", { name: "Unread" })).toHaveCount(1);

  // Opening it clears the dot and shows what she said. The read mark is waited
  // for as the request it makes, not as a dot that goes: toHaveCount(0) is true
  // the instant before an element renders as well as the instant after it goes,
  // so on its own it would pass against a screen that never marked anything.
  const marked = bob.waitForResponse((response) =>
    response.url().includes("/rest/v1/rpc/mark_read"),
  );
  await row.click();
  await expect(bob.getByText(ADA_HELLO)).toBeVisible();
  await marked;
  await bob.goto("/messages");
  await expect(bob.getByRole("img", { name: "Unread" })).toHaveCount(0);

  // Ada's page is left open on the conversation. Bob answers, and it lands
  // there with nothing reloaded.
  const live = subscribed(ada, "conversation");
  await ada.reload();
  await live;

  await bob.goto("/messages");
  await bob.getByRole("link").filter({ hasText: BOB_ROW_MATCH }).click();
  await bob.getByRole("textbox", { name: "Message @ada" }).fill(BOB_ANSWER);
  await bob.getByRole("button", { name: "Send" }).click();

  await expect(ada.getByText(BOB_ANSWER)).toBeVisible();
  await shot(ada, "conversation-mobile");
});
