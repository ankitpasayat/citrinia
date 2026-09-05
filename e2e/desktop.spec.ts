// The same feed on a wide screen. Runs after the mobile narrative (see
// `dependencies` in playwright.config.ts) against the state it leaves behind.
import { expect, test } from "./fixtures.ts";

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

  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/screenshots/feed-desktop.png" });
});
