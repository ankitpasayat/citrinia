// One clean slate per run, so the suite says the same thing the second time.
import { BASE_URL } from "../playwright.config.ts";
import { ensureUsers, resetData } from "./db.ts";

export default async function globalSetup(): Promise<void> {
  const login = await fetch(`${BASE_URL}/login`).catch((error: unknown) => {
    throw new Error(
      `Nothing is serving ${BASE_URL}. Build and start it first — see "End to end" in the README.\n${String(error)}`,
    );
  });
  if (!login.ok) throw new Error(`${BASE_URL}/login answered ${login.status}, expected 200.`);

  await ensureUsers();
  await resetData();
}
