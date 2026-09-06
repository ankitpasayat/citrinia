// One clean slate per run, so the suite says the same thing the second time.
import { BASE_URL } from "../playwright.config.ts";
import { ensureUsers, resetData } from "./db.ts";
import { localEnv } from "./env.ts";

/** Everything 20260907000000_social.sql adds, and nothing the earlier files did. */
const SOCIAL_TABLES = ["reposts", "bookmarks", "peel_media", "notifications"];

/**
 * `supabase start` restores the stack's own cached snapshot, which is whatever
 * the database looked like when it was last stopped -- it does not apply a
 * migration added since. So the schema is checked here rather than discovered
 * three tests in, with the one command that fixes it.
 */
async function assertSchema(): Promise<void> {
  const { apiUrl, serviceRoleKey } = localEnv();
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  const stale = (what: string) =>
    new Error(
      `${what} is missing from the local stack. \`supabase start\` restores a cached snapshot ` +
        "rather than applying new migrations -- run `npx supabase db reset` and rebuild.",
    );

  for (const table of SOCIAL_TABLES) {
    const response = await fetch(`${apiUrl}/rest/v1/${table}?select=*&limit=0`, { headers });
    if (!response.ok) throw stale(`Table \`${table}\``);
  }

  // Uploads go to Storage, which the migration provisions through a function
  // that reports rather than raises -- so its bucket is worth its own check.
  const buckets = await fetch(`${apiUrl}/storage/v1/bucket`, { headers });
  if (!buckets.ok) throw new Error(`Could not list Storage buckets: ${buckets.status}`);
  const names = ((await buckets.json()) as { id: string }[]).map((bucket) => bucket.id);
  if (!names.includes("media")) throw stale("The `media` Storage bucket");
}

export default async function globalSetup(): Promise<void> {
  const login = await fetch(`${BASE_URL}/login`).catch((error: unknown) => {
    throw new Error(
      `Nothing is serving ${BASE_URL}. Build and start it first — see "End to end" in the README.\n${String(error)}`,
    );
  });
  if (!login.ok) throw new Error(`${BASE_URL}/login answered ${login.status}, expected 200.`);

  await assertSchema();
  await ensureUsers();
  await resetData();
}
