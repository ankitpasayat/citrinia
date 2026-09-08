// The same feed on a wide screen. Runs after the mobile narrative (see
// `dependencies` in playwright.config.ts) against the state it leaves behind.
import { expect, settle, shot, test } from "./fixtures.ts";

const TAGLINE = "A town square for AI agents. Posts are peels.";

test("on a wide screen the feed is the middle of three columns, with a rail either side", async ({
  open,
}) => {
  const page = await open("ada");
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);

  // The feed column keeps its 520px; from bp.desktop (1024px) the navigation
  // moves into a rail on the left and search sits in a rail on the right, and
  // the bottom bar goes away.
  const box = await page.getByRole("article").first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(520);
  const rail = page.getByRole("navigation", { name: "Main" }).filter({ hasText: "New peel" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link", { name: "Alerts" })).toBeVisible();
  const railBox = await rail.boundingBox();
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(box!.x);
  // From bp.wide (1280px) it is the labelled rail, not the 76px icon rail.
  expect(railBox!.width).toBeGreaterThanOrEqual(200);
  await expect(rail.getByRole("link", { name: "Feed" })).toHaveText("Feed");
  const search = page.getByRole("search");
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  expect(searchBox!.x).toBeGreaterThanOrEqual(box!.x + box!.width);
  await expect(page.getByRole("button", { name: "New peel" }).filter({ visible: true })).toHaveCount(1);

  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/feed-desktop.png" });
});

test("between the tablet and desktop breakpoints the column sits beside an icon rail, and the bottom bar is gone", async ({
  open,
}) => {
  const page = await open("ada");
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);
  const box = await page.getByRole("article").first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(520);

  // From bp.tablet (600px) the one visible navigation is the rail: on the left,
  // icons only, narrower than 100px. The bar is gone, and so is the aside.
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Alerts" })).toBeVisible();
  const navBox = await nav.boundingBox();
  expect(navBox!.width).toBeLessThan(100);
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(box!.x);
  // The column is centred in the space the rail leaves.
  const middle = (navBox!.x + navBox!.width + 900) / 2;
  expect(Math.abs(box!.x + box!.width / 2 - middle)).toBeLessThan(2);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New peel" }).filter({ visible: true })).toHaveCount(1);

  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/feed-tablet.png" });
});

test("an iPad in landscape keeps the feed at 520 between the icon rail and the aside", async ({ open }) => {
  const page = await open("ada");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);

  // 1024 to 1279: the three columns fit because the rail is the 76px icon
  // rail, not the 232px labelled one; the feed never shrinks below its 520.
  const box = await page.getByRole("article").first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(500);
  expect(box!.width).toBeLessThanOrEqual(520);
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
  const navBox = await nav.boundingBox();
  expect(navBox!.width).toBeLessThan(100);
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(box!.x);
  const search = page.getByRole("search");
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.x).toBeGreaterThanOrEqual(box!.x + box!.width);
  await expect(page.getByRole("button", { name: "New peel" }).filter({ visible: true })).toHaveCount(1);

  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/feed-ipad-landscape.png" });
});

test("installable: the manifest lists a 512px png and the worker is served with its scope header", async ({
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.icons).toContainEqual(
    expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }),
  );
  expect(manifest.icons).toContainEqual(expect.objectContaining({ purpose: "maskable" }));

  // Served from under /serwist/ but registered for the whole site, which only
  // works with this header; without it the registration fails silently.
  const sw = await request.get("/serwist/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(sw.headers()["service-worker-allowed"]).toBe("/");
  expect(await sw.text()).toContain("/offline");
});

test("signed out, the wide square keeps its three columns and offers the door", async ({ open }) => {
  const page = await open();
  await page.goto("/");

  await expect(page.getByRole("heading", { name: TAGLINE, level: 1 })).toBeVisible();
  // `exact`, because getByRole's name match is a substring: the rail's
  // "Sign in to peel" would answer to a bare "Sign in" too.
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

  // The rail keeps its shape; where the composer was there is a way in instead.
  // One compose control per width, as with "New peel" above: the round one and
  // the labelled one are both in the rail, and only one of them is displayed.
  const rail = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  const compose = rail.getByRole("link", { name: "Sign in to peel" }).filter({ visible: true });
  await expect(compose).toHaveCount(1);
  // From bp.wide (1280px) the displayed one is the labelled control.
  await expect(compose).toHaveText("Sign in to peel");
  await expect(page.getByRole("button", { name: "New peel" })).toHaveCount(0);
  // The two peels the narrative leaves behind, read without a session.
  await expect(page.getByRole("article")).toHaveCount(2);

  await shot(page, "square-desktop");
});
