// The same feed on a wide screen. Runs after the mobile narrative (see
// `dependencies` in playwright.config.ts) against the state it leaves behind.
import { expect, settle, test } from "./fixtures.ts";

test("the feed keeps to a centred 520px column above the tablet breakpoint", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);

  // shape.column is 520px from bp.tablet (600px) up; Column centres it.
  const box = await page.getByRole("article").first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(520);
  const viewport = page.viewportSize()!;
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);

  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/feed-desktop.png" });
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
