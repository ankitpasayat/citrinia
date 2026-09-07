// The one way the suite opens a browser.
//
// Every page it hands out is watched: an uncaught page error, or a console line
// that looks like a React/hydration complaint, fails the test that produced it
// (asserted in fixture teardown, once the flows have finished).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config.ts";
import { signInContext, type Credentials } from "./auth.ts";
import type { UserKey } from "./env.ts";

const NOISE = /hydration|Warning: |Error:/;

// The GitHub avatars are the one thing on these pages that reaches the internet.
// Serve them locally so a run is hermetic and the screenshots do not vary.
const AVATAR_FILL: Record<string, string> = { "1": "#D4551B", "2": "#E8A33D" };

function avatarSvg(url: string): string {
  const fill = AVATAR_FILL[url.split("/").pop() ?? ""] ?? "#8C6A52";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><circle cx="32" cy="25" r="11" fill="#FFF1E6"/><circle cx="32" cy="57" r="18" fill="#FFF1E6"/></svg>`;
}

// The other two: a YouTube still and the player it links to. The assertions are
// about the urls the app builds, not about YouTube, and a real embed would put
// somebody else's console noise in `problems`.
const YOUTUBE_STILL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="#3A2A22"/><circle cx="240" cy="180" r="54" fill="#FFF1E6"/><path d="M222 152l56 28-56 28z" fill="#3A2A22"/></svg>';
const YOUTUBE_PLAYER =
  '<!doctype html><meta charset="utf-8"><title>Stubbed player</title><body style="margin:0;background:#000"></body>';

/** A picture on somebody else's CDN, which is what peel_media.url usually is. */
export const REMOTE_IMAGE = "https://images.citrinia.test/orange-square.png";
const REMOTE_IMAGE_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#D4551B"/></svg>';

type Fixtures = {
  /** A fresh page, signed in as `user` — a fixture key, or the credentials of an
   *  account the test made itself — or signed out when called with nothing. */
  open: (user?: UserKey | Credentials) => Promise<Page>;
  /** Page errors and suspicious console lines seen this test; asserted empty at teardown. */
  problems: string[];
};

export const test = base.extend<Fixtures>({
  // `provide`, not `use`: Playwright passes it positionally, and the name `use`
  // trips eslint's react-hooks/rules-of-hooks in this otherwise React-free file.
  problems: async ({}, provide) => {
    const problems: string[] = [];
    await provide(problems);
    expect(problems, "page errors and console warnings").toEqual([]);
  },

  open: async ({ browser, problems }, provide, testInfo) => {
    const contexts: BrowserContext[] = [];

    await provide(async (user?: UserKey | Credentials) => {
      const context = await browser.newContext({
        viewport: testInfo.project.use.viewport,
        deviceScaleFactor: 1,
      });
      contexts.push(context);
      await context.route("**://avatars.githubusercontent.com/**", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: avatarSvg(route.request().url()) }),
      );
      await context.route("**://i.ytimg.com/**", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: YOUTUBE_STILL }),
      );
      await context.route("**://www.youtube-nocookie.com/**", (route) =>
        route.fulfill({ contentType: "text/html", body: YOUTUBE_PLAYER }),
      );
      await context.route("**://images.citrinia.test/**", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: REMOTE_IMAGE_BODY }),
      );
      if (user) await signInContext(context, user);

      const page = await context.newPage();
      const who = user === undefined ? "signed out" : typeof user === "string" ? user : user.email;
      page.on("pageerror", (error) => problems.push(`[${who}] pageerror: ${error.message}`));
      page.on("console", (message) => {
        const text = message.text();
        if (NOISE.test(text)) problems.push(`[${who}] console.${message.type()}: ${text}`);
      });
      return page;
    });

    for (const context of contexts) await context.close();
  },
});

/** Fonts and the view transition settled, so a screenshot is the same every run.
 *  The theme cross-fade in app/globals.css runs 0.7s, so wait past it. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

export async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `e2e/screenshots/${name}.png` });
}

/** The one card whose text contains `text`. */
export function card(page: Page, text: string) {
  return page.getByRole("article").filter({ hasText: text });
}

/**
 * A realtime channel actually listening (the feed's, or the bell's when `topic` says so).
 *
 * `subscribe()` returns long before the server has accepted the postgres_changes
 * subscription — the client sends setAuth, joins, and only then is told
 * "Subscribed to PostgreSQL" — and a row inserted inside that gap is never
 * announced at all. Call this *before* navigating, await it after, and the
 * "somebody peeled while you were reading" tests stop being a coin flip.
 */
export function subscribed(page: Page, topic = ""): Promise<void> {
  return new Promise<void>((resolve) => {
    page.on("websocket", (socket) => {
      socket.on("framereceived", (frame) => {
        // A page can hold more than one channel (the feed's and the bell's), and
        // the acknowledgement names its topic, so a caller can wait for a specific one.
        const text = frame.payload.toString();
        if (text.includes("Subscribed to PostgreSQL") && text.includes(topic)) resolve();
      });
    });
  });
}

/** A server action actually reaching the server: the app's own POST coming back. */
export function actionWrite(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().startsWith(`${BASE_URL}/`),
  );
}

export { expect };
export type { Page };
