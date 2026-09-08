// One clean slate per run, so the suite says the same thing the second time.
import { BASE_URL } from "../playwright.config.ts";
import { ensureUsers, resetData } from "./db.ts";
import { localEnv } from "./env.ts";

/** The tables the migrations after the first two add, newest last. */
const LATER_TABLES = [
  "reposts",
  "bookmarks",
  "peel_media",
  "notifications",
  "username_history",
  "reports",
  "mutes",
  "blocks",
  "link_previews",
  "conversations",
  "messages",
  "agent_signups",
];

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

  for (const table of LATER_TABLES) {
    const response = await fetch(`${apiUrl}/rest/v1/${table}?select=*&limit=0`, { headers });
    if (!response.ok) throw stale(`Table \`${table}\``);
  }

  // A migration can also add a function, which no table check would notice: the
  // thread page's ancestor walk is one, and without it every peel page errors.
  const ancestors = await fetch(`${apiUrl}/rest/v1/rpc/peel_ancestors`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ of_peel: "00000000-0000-0000-0000-000000000000" }),
  });
  if (!ancestors.ok) throw stale("The `peel_ancestors` function");

  // The rename is a function too, and username is granted to nobody -- without
  // it the edit sheet can save everything except the one field it added.
  const rename = await fetch(`${apiUrl}/rest/v1/rpc/change_username`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ new_username: "" }),
  });
  // 404 is "no such function"; a 4xx from its own validation means it is there.
  if (rename.status === 404) throw stale("The `change_username` function");

  // Every peel goes up through add_thread() now, so a stack without it cannot
  // post at all -- and an empty thread is refused by the function's own
  // validation, which is how a 4xx tells us it is there.
  const thread = await fetch(`${apiUrl}/rest/v1/rpc/add_thread`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [] }),
  });
  if (thread.status === 404) throw stale("The `add_thread` function");

  // Sending is a function too, and it is the only way a message is ever written:
  // a stack without it has the tables and still cannot say a word.
  const send = await fetch(`${apiUrl}/rest/v1/rpc/send_message`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ to_user: "00000000-0000-0000-0000-000000000000", body: "" }),
  });
  if (send.status === 404) throw stale("The `send_message` function");

  // Uploads go to Storage, which the migration provisions through a function
  // that reports rather than raises -- so its bucket is worth its own check.
  const buckets = await fetch(`${apiUrl}/storage/v1/bucket`, { headers });
  if (!buckets.ok) throw new Error(`Could not list Storage buckets: ${buckets.status}`);
  const names = ((await buckets.json()) as { id: string }[]).map((bucket) => bucket.id);
  if (!names.includes("media")) throw stale("The `media` Storage bucket");
  if (!names.includes("avatars")) throw stale("The `avatars` Storage bucket");

  // A migration that only adds columns passes every check above, and then the
  // profile page renders a banner nobody has.
  const profile = await fetch(
    `${apiUrl}/rest/v1/profiles?select=banner_url,location,website,created_at&limit=0`,
    { headers },
  );
  if (!profile.ok) throw stale("The profile's banner_url/location/website/created_at columns");
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
