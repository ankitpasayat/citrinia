// Data setup and out-of-band writes, straight against the local stack's REST API.
//
// Only global setup uses the service role. Everything a test does mid-flow goes
// through a real user's token, so RLS is exercised rather than bypassed.
import { localEnv, USERS, type UserKey } from "./env.ts";
import { signIn } from "./auth.ts";

async function rest(
  path: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { apiUrl, anonKey } = localEnv();
  const { token, headers, ...rest } = init;
  const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`REST ${init.method ?? "GET"} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response;
}

/** Every peel, like, follow and profile edit from a previous run, undone. */
export async function resetData(): Promise<void> {
  const { serviceRoleKey: token } = localEnv();
  // Peels cascade to their replies and likes; follows have no surrogate key.
  await rest("peels?id=not.is.null", { method: "DELETE", token });
  await rest("follows?follower_id=not.is.null", { method: "DELETE", token });
  for (const user of Object.values(USERS)) {
    await rest(`profiles?username=eq.${user.username}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ name: user.name, bio: "" }),
    });
  }
}

/** Create ada and bob if this is a fresh stack. The signup trigger writes their profiles. */
export async function ensureUsers(): Promise<void> {
  const { apiUrl, serviceRoleKey } = localEnv();
  const existing = await rest("profiles?select=username", { token: serviceRoleKey });
  const usernames = new Set(((await existing.json()) as { username: string }[]).map((row) => row.username));

  for (const user of Object.values(USERS)) {
    if (usernames.has(user.username)) continue;
    const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        // The trigger reads exactly these three keys out of the GitHub metadata.
        user_metadata: { name: user.name, user_name: user.username, avatar_url: user.avatarUrl },
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not seed ${user.email}: ${response.status} ${await response.text()}`);
    }
  }

  // The trigger runs after the insert; make sure both profiles landed.
  const after = await rest("profiles?select=username", { token: serviceRoleKey });
  const seeded = new Set(((await after.json()) as { username: string }[]).map((row) => row.username));
  for (const user of Object.values(USERS)) {
    if (!seeded.has(user.username)) throw new Error(`No profile row for @${user.username} after signup.`);
  }
}

/** Post a peel as `user` over REST — the "someone else peeled" half of the realtime test.
 *  Pass `parentId` to make it a reply. Returns the new peel's id. */
export async function peelAs(user: UserKey, title: string, parentId?: string): Promise<string> {
  const api = await restAs(user);
  const [row] = await api.insert<{ id: string }>("peels", {
    title,
    user_id: api.id,
    parent_id: parentId ?? null,
  });
  return row.id;
}

/**
 * A PostgREST client bound to one identity, for the writes a test has to make
 * from outside the browser (another user acting while a page is open, or a bulk
 * fixture too big to type into a composer).
 */
export type Rest = {
  /** The signed-in user's id. Empty for the service role, which is nobody. */
  id: string;
  select<T>(path: string): Promise<T[]>;
  insert<T>(table: string, rows: unknown): Promise<T[]>;
  update(path: string, patch: unknown): Promise<void>;
  remove(path: string): Promise<void>;
};

function client(token: string, id: string): Rest {
  return {
    id,
    async select<T>(path: string): Promise<T[]> {
      return (await (await rest(path, { token })).json()) as T[];
    },
    async insert<T>(table: string, rows: unknown): Promise<T[]> {
      const response = await rest(table, {
        method: "POST",
        token,
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
      return (await response.json()) as T[];
    },
    async update(path: string, patch: unknown): Promise<void> {
      await rest(path, { method: "PATCH", token, body: JSON.stringify(patch) });
    },
    async remove(path: string): Promise<void> {
      await rest(path, { method: "DELETE", token });
    },
  };
}

/** Act as a real user, so RLS is exercised rather than bypassed. */
export async function restAs(user: UserKey): Promise<Rest> {
  const session = await signIn(user);
  return client(session.access_token, session.user.id);
}

/** Act as the service role: fixture bulk-loading, and reading tables RLS hides. */
export function restAsService(): Rest {
  return client(localEnv().serviceRoleKey, "");
}

/** The objects one user has put in the `media` bucket, as `<uid>/<file>` paths. */
export async function listMedia(userId: string): Promise<string[]> {
  const { apiUrl, serviceRoleKey } = localEnv();
  const response = await fetch(`${apiUrl}/storage/v1/object/list/media`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: `${userId}/`, limit: 100 }),
  });
  if (!response.ok) {
    throw new Error(`Storage list -> ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { name: string }[]).map((object) => `${userId}/${object.name}`);
}

/** The url Storage serves an object at — what supabase-js getPublicUrl() builds. */
export function mediaUrl(path: string): string {
  return `${localEnv().apiUrl}/storage/v1/object/public/media/${path}`;
}

/**
 * Throwaway accounts, made and unmade inside one test: a list only gets
 * interesting past a page boundary, and PAGE_SIZE is 20. A real signup each,
 * because a profile hangs off auth.users -- but no password, since nobody signs
 * in as them and hashing one is the slow part. The trigger writes the profiles.
 */
export async function makeExtras(n: number, prefix: string): Promise<{ id: string; username: string }[]> {
  const { apiUrl, serviceRoleKey } = localEnv();
  const made: { id: string; username: string }[] = [];

  for (let i = 1; i <= n; i++) {
    const username = `${prefix}${String(i).padStart(2, "0")}`;
    const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${username}@citrinia.test`,
        email_confirm: true,
        // No avatar: initials render without a request going out for 21 pictures.
        user_metadata: { name: `Pip ${username.slice(prefix.length)}`, user_name: username, avatar_url: "" },
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not create ${username}: ${response.status} ${await response.text()}`);
    }
    made.push({ id: ((await response.json()) as { id: string }).id, username });
  }
  return made;
}

/** Undo `makeExtras`: deleting the account takes its profile and its follows with it. */
export async function removeExtras(ids: string[]): Promise<void> {
  const { apiUrl, serviceRoleKey } = localEnv();
  for (const id of ids) {
    const response = await fetch(`${apiUrl}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!response.ok) {
      throw new Error(`Could not delete ${id}: ${response.status} ${await response.text()}`);
    }
  }
}
