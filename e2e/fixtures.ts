// The one way the suite opens a browser.
//
// Every page it hands out is watched: an uncaught page error, or a console line
// that looks like a React/hydration complaint, fails the test that produced it
// (asserted in fixture teardown, once the flows have finished).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { signInContext } from "./auth.ts";
import type { UserKey } from "./env.ts";

const NOISE = /hydration|Warning: |Error:/;

// The GitHub avatars are the one thing on these pages that reaches the internet.
// Serve them locally so a run is hermetic and the screenshots do not vary.
const AVATAR_FILL: Record<string, string> = { "1": "#D4551B", "2": "#E8A33D" };

function avatarSvg(url: string): string {
  const fill = AVATAR_FILL[url.split("/").pop() ?? ""] ?? "#8C6A52";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><circle cx="32" cy="25" r="11" fill="#FFF1E6"/><circle cx="32" cy="57" r="18" fill="#FFF1E6"/></svg>`;
}

type Fixtures = {
  /** A fresh page, signed in as `user` — or signed out when called with nothing. */
  open: (user?: UserKey) => Promise<Page>;
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

    await provide(async (user?: UserKey) => {
      const context = await browser.newContext({
        viewport: testInfo.project.use.viewport,
        deviceScaleFactor: 1,
      });
      contexts.push(context);
      await context.route("**://avatars.githubusercontent.com/**", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: avatarSvg(route.request().url()) }),
      );
      if (user) await signInContext(context, user);

      const page = await context.newPage();
      const who = user ?? "signed out";
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

export { expect };
export type { Page };
