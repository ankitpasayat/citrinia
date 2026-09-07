// Signing in without GitHub.
//
// The app only offers the GitHub provider, which cannot be completed headlessly,
// so the suite mints a session out of band with the password grant and writes the
// cookie @supabase/ssr reads. Both halves of that cookie are derived from the
// installed sources, not from memory:
//
//   name  supabase-js's SupabaseClient: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
//         (so http://127.0.0.1:54321 -> `sb-127-auth-token`).
//   value @supabase/ssr cookies.ts, cookieEncoding "base64url" (its default):
//         "base64-" + base64url(JSON.stringify(session)), where the stored item is
//         whatever auth-js `_saveSession` hands storage, i.e. the token response.
//         Split into `name.0`, `name.1`, ... above MAX_CHUNK_SIZE (3180).
import type { BrowserContext, Cookie } from "@playwright/test";
import { localEnv, USERS, type UserKey } from "./env.ts";

/** @supabase/ssr utils/chunker.ts */
const MAX_CHUNK_SIZE = 3180;
const BASE64_PREFIX = "base64-";

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
};

export type Credentials = { email: string; password: string };

/** Exchange a password for a session, the way the browser client would store it. */
export async function signIn(user: UserKey): Promise<Session> {
  return signInAs(USERS[user]);
}

/** The same, for an account a test made rather than one global setup seeded. */
export async function signInAs({ email, password }: Credentials): Promise<Session> {
  const { apiUrl, anonKey } = localEnv();
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Password grant failed for ${email}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Session;
}

function storageKey(apiUrl: string): string {
  return `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * The chunks @supabase/ssr would have written. Its createChunks() measures the
 * URI-encoded value and keeps chunks on a UTF-8 boundary; the encoded value here
 * is `base64-` plus the base64url alphabet, every character of which
 * encodeURIComponent leaves alone, so a plain slice is the same split.
 */
function chunks(name: string, value: string): { name: string; value: string }[] {
  if (value.length <= MAX_CHUNK_SIZE) return [{ name, value }];
  const parts: { name: string; value: string }[] = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    parts.push({
      name: `${name}.${i}`,
      value: value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
    });
  }
  return parts;
}

/** The auth cookies for a session, ready for BrowserContext.addCookies(). */
export function sessionCookies(session: Session, domain = "127.0.0.1"): Cookie[] {
  const { apiUrl } = localEnv();
  const encoded = BASE64_PREFIX + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return chunks(storageKey(apiUrl), encoded).map(({ name, value }) => ({
    name,
    value,
    domain,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));
}

/** Sign `context` in as `user` (a fixture account, or credentials a test made),
 *  and hand back the session for API calls as them. */
export async function signInContext(
  context: BrowserContext,
  user: UserKey | Credentials,
): Promise<Session> {
  const session = typeof user === "string" ? await signIn(user) : await signInAs(user);
  await context.addCookies(sessionCookies(session));
  return session;
}
