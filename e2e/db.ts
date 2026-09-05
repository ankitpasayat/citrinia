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

/** Post a peel as `user` over REST — the "someone else peeled" half of the realtime test. */
export async function peelAs(user: UserKey, title: string): Promise<void> {
  const session = await signIn(user);
  await rest("peels", {
    method: "POST",
    token: session.access_token,
    body: JSON.stringify({ title, user_id: session.user.id }),
  });
}
