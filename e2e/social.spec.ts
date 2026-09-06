// The social layer, driven end to end in a real browser against the same local
// stack and the same two accounts as mvp.spec.ts. It picks the narrative up
// where that one left it -- ada's peel with its reply, bob's peel, bob following
// ada, and bob renamed "Bob Peeler" by mvp test 7 -- so it runs last (see the
// `social` project in playwright.config.ts).
import { deflateSync } from "node:zlib";
import { actionWrite, card, expect, REMOTE_IMAGE, shot, subscribed, test, type Page } from "./fixtures.ts";
import { listMedia, mediaUrl, peelAs, restAs, restAsService } from "./db.ts";

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

/** How many older peels test 8 bulk-loads. PAGE_SIZE in lib/peels.ts is 20. */
const OLDER = 25;
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
    "/search?q=%23citrus",
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

  const before = await listMedia(adaId);
  const posted = actionWrite(ada);
  await sheet.getByRole("button", { name: "Peel it" }).click();
  await posted;

  // The file itself goes straight to the bucket, into the uploader's own folder,
  // and it really lands there: the public url serves it back.
  const uploaded = (await listMedia(adaId)).filter((path) => !before.includes(path));
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0].startsWith(`${adaId}/`)).toBe(true);
  const url = mediaUrl(uploaded[0]);
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
  await expect.poll(() => listMedia(adaId)).toEqual(before);

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

  // Every row of one insert shares the transaction's now(), which would leave
  // the keyset cursor with nothing to bite on -- so the clock is set by hand.
  const start = Date.parse("2026-08-01T12:00:00.000Z");
  await db.insert(
    "peels",
    Array.from({ length: OLDER }, (_, i) => ({
      title: olderTitle(i + 1),
      user_id: bob.id,
      parent_id: null,
      created_at: new Date(start + i * 60_000).toISOString(),
    })),
  );

  const ada = await open("ada");
  await ada.goto("/");
  await expect(ada.getByRole("article")).toHaveCount(20);
  await expect(card(ada, olderTitle(OLDER))).toHaveCount(1);
  await expect(card(ada, olderTitle(1))).toHaveCount(0);
  const firstPage = await shownIds(ada);

  await ada.getByRole("link", { name: "Show older peels" }).click();
  await expect(ada).toHaveURL(/\?before=/);
  // 7 top-level peels and one repeel by now, plus the 25 above: 33 rows, so the
  // second page is the remaining 13 and there is nothing after it.
  await expect(ada.getByRole("article")).toHaveCount(13);
  await expect(card(ada, olderTitle(1))).toHaveCount(1);
  const secondPage = await shownIds(ada);
  expect(secondPage.filter((id) => firstPage.includes(id))).toEqual([]);
  await expect(ada.getByRole("link", { name: "Show older peels" })).toHaveCount(0);

  // Past the last row there is nothing left, and the copy says so.
  await ada.goto(`/?before=${encodeURIComponent(new Date(start).toISOString())}`);
  await expect(ada.getByRole("heading", { name: "That's all the peels." })).toBeVisible();
  await expect(ada.getByText("You've reached the end.")).toBeVisible();

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
  await bob.goto("/search");
  const onSearch = bob.getByRole("heading", { name: "Who to follow" }).locator("..");
  await expect(onSearch.getByRole("link", { name: /Ada Lovelace/ })).toHaveAttribute(
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
  await bob.goto("/search");
  await expect(bob.getByRole("link", { name: /Ada Lovelace/ })).toHaveCount(0);
});
