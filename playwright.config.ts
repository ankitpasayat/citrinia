import { defineConfig, devices } from "@playwright/test";

// The suite drives a production build (`next start -p 3210`) against a local
// Supabase stack; see the "End to end" section of the README for the two
// commands that have to be running first. Port 3000 is left alone on purpose.
export const BASE_URL = "http://127.0.0.1:3210";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One narrative against one database: order is part of the fixture.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      testMatch: /mvp\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      // Runs after the narrative, against the state it leaves behind.
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      dependencies: ["mobile"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // The social layer picks the narrative back up where the MVP left it, so it
      // runs last: it fills the feed with enough peels to page, which is not the
      // two-card feed the desktop check measures its column against.
      name: "social",
      testMatch: /social\.spec\.ts/,
      dependencies: ["desktop"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
