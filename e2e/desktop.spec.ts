// The same feed on a wide screen. Runs after the mobile narrative (see
// `dependencies` in playwright.config.ts) against the state it leaves behind.
import { expect, settle, test } from "./fixtures.ts";

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
  const search = page.getByRole("search");
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  expect(searchBox!.x).toBeGreaterThanOrEqual(box!.x + box!.width);
  await expect(page.getByRole("button", { name: "New peel" }).filter({ visible: true })).toHaveCount(1);

  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/feed-desktop.png" });
});

test("between the tablet and desktop breakpoints the phone layout is centred, bottom bar and all", async ({
  open,
}) => {
  const page = await open("ada");
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);
  const box = await page.getByRole("article").first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(520);
  expect(Math.abs(box!.x + box!.width / 2 - 450)).toBeLessThan(2);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Alerts" })).toHaveCount(1);
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
