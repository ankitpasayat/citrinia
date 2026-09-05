// The signed-in MVP, driven end to end in a real browser against a local
// Supabase stack. One narrative on one database, in order: what test 2 posts,
// test 3 replies to and test 11 deletes.
import { expect, test, type Page } from "./fixtures.ts";
import { peelAs } from "./db.ts";

const PEEL = "first peel from ada 🍊";
const REPLY = "hello from the thread";
const BOB_PEEL = "bob peels in from the outside";

// app/tokens.stylex.ts, light values. Playwright's default colorScheme is light.
const DANGER = "rgb(198, 40, 40)"; // colors.danger #C62828
const DARK_GROUND = "rgb(42, 26, 18)"; // app/themes.ts darkTheme ground #2A1A12

/** Fonts and the view transition settled, so a screenshot is the same every run.
 *  The theme cross-fade in app/globals.css runs 0.7s, so wait past it. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `e2e/screenshots/${name}.png` });
}

/** The one card whose text contains `text`. */
function card(page: Page, text: string) {
  return page.getByRole("article").filter({ hasText: text });
}

/**
 * The like write actually reaching Postgres. The chip paints the new state
 * before the round trip, so a reload or a closing context milliseconds later
 * cancels the request in flight — waiting on the response is what makes
 * "and it stuck" a real assertion rather than a coin flip.
 */
function likeWrite(page: Page, method: "POST" | "DELETE") {
  return page.waitForResponse(
    (r) => r.request().method() === method && r.url().includes("/rest/v1/likes") && r.status() < 400,
  );
}

/** Same, for a server action: the app's own POST coming back. */
function actionWrite(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().startsWith("http://127.0.0.1:3210/"),
  );
}

test.describe.configure({ mode: "serial" });

test("1. signed out: / is the login screen, and an unknown path composts", async ({ open }) => {
  const page = await open();

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "A tiny feed. Posts are peels." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  await shot(page, "login-mobile");

  const missing = await page.goto("/nope");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "That peel got composted." })).toBeVisible();
});

test("2. ada peels: empty feed, live counter, and the card lands on top", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");

  await expect(page.getByText("Hi Ada Lovelace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No peels yet" })).toBeVisible();

  await page.getByRole("button", { name: "New peel" }).click();
  await expect(page.getByRole("heading", { name: "New peel" })).toBeVisible();

  const peelIt = page.getByRole("button", { name: "Peel it" });
  await expect(peelIt).toBeDisabled();

  const box = page.getByRole("textbox", { name: "Your peel" });
  await box.fill(PEEL);
  // 21 code points, not the 22 UTF-16 units of PEEL.length: lib/peel.ts counts
  // code points to match the Postgres char_length() check, so the emoji is one.
  expect(PEEL.length).toBe(22);
  expect(Array.from(PEEL).length).toBe(21);
  await expect(page.getByText("259 left")).toBeVisible();

  await peelIt.click();
  await expect(page.getByRole("heading", { name: "New peel" })).toBeHidden();

  const first = page.getByRole("article").first();
  await expect(first).toContainText(PEEL);
  await expect(first.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await expect(first).toContainText("@ada");

  // Over the limit: danger pill, locked button.
  await page.getByRole("button", { name: "New peel" }).click();
  await page.getByRole("textbox", { name: "Your peel" }).fill("x".repeat(281));
  const over = page.getByText("1 over");
  await expect(over).toBeVisible();
  await expect(over).toHaveCSS("background-color", DANGER);
  await expect(page.getByRole("button", { name: "Peel it" })).toBeDisabled();
});

test("3. ada replies in the thread, and the feed counts it", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");

  await card(page, PEEL).getByRole("link", { name: /replies$/ }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "No replies yet" })).toBeVisible();

  await page.getByRole("textbox", { name: "Reply to @ada" }).fill(REPLY);
  await page.getByRole("button", { name: "Peel it" }).click();
  await expect(card(page, REPLY)).toHaveCount(1);
  await shot(page, "thread-mobile");

  await page.goto("/");
  await expect(card(page, PEEL).getByRole("link", { name: "1 replies" })).toBeVisible();
});

test("4. ada likes and unlikes her own peel", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");

  const like = card(page, PEEL).getByRole("button", { name: /likes$/ });
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await expect(like).toHaveAccessibleName("Like, 0 likes");

  const liked = likeWrite(page, "POST");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(like).toHaveAccessibleName("Unlike, 1 likes");
  await liked;

  const unliked = likeWrite(page, "DELETE");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await expect(like).toHaveAccessibleName("Like, 0 likes");
  await unliked;

  await page.reload();
  await expect(card(page, PEEL).getByRole("button", { name: /likes$/ })).toHaveAccessibleName("Like, 0 likes");
});

test("5. bob follows ada, and Following fills up", async ({ open }) => {
  const bob = await open("bob");

  await bob.goto("/");
  await expect(bob.getByRole("article")).toHaveCount(1);
  await expect(card(bob, PEEL)).toBeVisible();
  // Someone else's peel has no dots menu.
  await expect(card(bob, PEEL).getByRole("button", { name: "More" })).toHaveCount(0);

  await bob.goto("/?tab=following");
  await expect(bob.getByText("Follow people to fill this up.")).toBeVisible();

  await bob.goto("/u/ada");
  await expect(bob.getByRole("heading", { name: "Ada Lovelace", level: 1 })).toBeVisible();
  // The handle and the counts belong to the profile head, not to a peel card below it.
  const head = bob.getByRole("heading", { name: "Ada Lovelace", level: 1 }).locator("..");
  await expect(head.getByText("@ada", { exact: true })).toBeVisible();
  const counts = head.getByRole("paragraph").filter({ hasText: "following" });
  await expect(counts).toHaveText(/1 peel.*0 followers.*0 following/);

  await bob.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(bob.getByRole("button", { name: "Following" })).toBeVisible();
  // The count comes from the server, so seeing it move proves the follow landed
  // (the button label alone is optimistic). "1 follower" is singular by design.
  await expect(counts).toHaveText(/1 peel.*1 follower(?!s).*0 following/);
  await bob.reload();
  await expect(bob.getByRole("button", { name: "Following" })).toBeVisible();
  await expect(counts).toHaveText(/1 peel.*1 follower(?!s).*0 following/);
  await shot(bob, "profile-mobile");

  await bob.goto("/?tab=following");
  await expect(card(bob, PEEL)).toBeVisible();

  const like = card(bob, PEEL).getByRole("button", { name: /likes$/ });
  const liked = likeWrite(bob, "POST");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(like).toHaveAccessibleName("Unlike, 1 likes");
  await liked;

  // Ada sees Bob's like on her peel, and it is not hers.
  const ada = await open("ada");
  await ada.goto("/");
  const adasView = card(ada, PEEL).getByRole("button", { name: /likes$/ });
  await expect(adasView).toHaveAccessibleName("Like, 1 likes");
  await expect(adasView).toHaveAttribute("aria-pressed", "false");
});

test("6. search finds people and peels, and user text stays literal", async ({ open }) => {
  const page = await open("bob");

  await page.goto("/search?q=ada");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ada Lovelace @ada" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peels" })).toBeVisible();
  await expect(card(page, PEEL)).toBeVisible();
  await shot(page, "search-mobile");

  // "%" is a LIKE wildcard and "*" is both a regex and a PostgREST-rewritten one:
  // escaped properly, neither matches anything, and neither 500s.
  for (const q of ["%", "*"]) {
    await page.goto(`/search?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole("heading", { name: "No peels match" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);
  }

  await page.goto("/search?q=lovel");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ada Lovelace @ada" })).toBeVisible();
});

test("7. bob edits his profile, and the bio limit holds", async ({ open }) => {
  const page = await open("bob");
  await page.goto("/u/bob");

  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Edit profile" })).toBeVisible();

  const bio = page.getByRole("textbox", { name: "Bio" });
  await bio.fill("x".repeat(161)); // lib/profile.ts MAX_BIO is 160
  const over = page.getByText("1 over");
  await expect(over).toBeVisible();
  await expect(over).toHaveCSS("background-color", DANGER);
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await bio.fill("peels and pith");
  await page.getByRole("textbox", { name: "Name" }).fill("Bob Peeler");
  await page.getByRole("button", { name: "Save" }).click();

  // Scoped to the profile head: the sheet's textarea still holds the same text.
  const head = page.getByRole("heading", { name: "Bob Peeler", level: 1 }).locator("..");
  await expect(head).toBeVisible();
  await expect(head.getByRole("paragraph").filter({ hasText: "peels and pith" })).toBeVisible();

  await page.reload();
  await expect(head).toBeVisible();
  await expect(head.getByRole("paragraph").filter({ hasText: "peels and pith" })).toBeVisible();
});

test("8. someone else's peel arrives on an open feed, with no reload", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(1);

  await peelAs("bob", BOB_PEEL);

  await expect(card(page, BOB_PEEL)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("9. the feed, on a phone", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);
  await shot(page, "feed-mobile");
});

test("10. theme survives a reload, and log out ends the session", async ({ open }) => {
  const page = await open("ada");
  await page.goto("/");
  const system = await page.evaluate(() => document.documentElement.className);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Dark" }).click();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  const dark = await page.evaluate(() => document.documentElement.className);
  expect(dark.split(" ").length).toBeGreaterThan(system.split(" ").length);
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_GROUND);

  await page.keyboard.press("Escape");
  await shot(page, "feed-dark-mobile");

  // The pre-paint script in app/layout.tsx, not a post-hydration flash.
  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_GROUND);
  expect(await page.evaluate(() => document.documentElement.className)).toBe(dark);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "System" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe(null);
  await expect.poll(() => page.evaluate(() => document.documentElement.className)).toBe(system);

  const logOut = page.getByRole("button", { name: "Log out" });
  await expect(logOut).toBeVisible();
  await logOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("11. ada deletes her own peel, and it is gone for everyone", async ({ open }) => {
  const ada = await open("ada");
  await ada.goto("/");

  await ada.getByRole("button", { name: "New peel" }).click();
  await ada.getByRole("textbox", { name: "Your peel" }).fill("delete me");
  await ada.getByRole("button", { name: "Peel it" }).click();
  const doomed = card(ada, "delete me");
  await expect(doomed).toHaveCount(1);

  await doomed.getByRole("button", { name: "More" }).click();
  await ada.getByRole("button", { name: "Delete peel" }).click();
  const confirm = ada.getByRole("button", { name: "Really delete? Tap again" });
  await expect(confirm).toBeVisible();
  const deleted = actionWrite(ada);
  await confirm.click();

  await expect(doomed).toHaveCount(0);
  await deleted;
  await ada.reload();
  await expect(card(ada, "delete me")).toHaveCount(0);
  await expect(ada.getByRole("article")).toHaveCount(2);

  const bob = await open("bob");
  await bob.goto("/");
  await expect(card(bob, "delete me")).toHaveCount(0);
  // Bob owns one of these two peels and not the other; only his has the menu.
  await expect(card(bob, BOB_PEEL).getByRole("button", { name: "More" })).toHaveCount(1);
  await expect(card(bob, PEEL).getByRole("button", { name: "More" })).toHaveCount(0);
});
