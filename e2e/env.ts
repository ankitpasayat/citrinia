// Local Supabase connection details, read from the running stack.
//
// `npx supabase status -o env` is the source of truth: the keys change every
// time the stack is recreated, so nothing here is hardcoded and nothing is
// written to a tracked file. Cached per process (workers: 1, so it runs twice
// at most: once in global setup, once in the worker).
import { execFileSync } from "node:child_process";

export type LocalEnv = {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

let cached: LocalEnv | undefined;

export function localEnv(): LocalEnv {
  if (cached) return cached;

  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase@latest", "status", "-o", "env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `Could not read the local Supabase status. Start it with \`npx supabase start\` first.\n${String(error)}`,
    );
  }

  const values = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }

  // The publishable key is what the app ships with; the legacy anon JWT is the
  // fallback for a stack old enough not to have one.
  const apiUrl = values.get("API_URL");
  const anonKey = values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY") ?? values.get("SECRET_KEY");
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error(`Incomplete \`supabase status -o env\` output:\n${raw}`);
  }

  cached = { apiUrl, anonKey, serviceRoleKey };
  return cached;
}

/** The two accounts the suite drives. GitHub OAuth cannot be completed headlessly. */
export const USERS = {
  ada: {
    email: "ada@example.com",
    password: "peel-ada-123",
    name: "Ada Lovelace",
    username: "ada",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
  },
  bob: {
    email: "bob@example.com",
    password: "peel-bob-123",
    name: "Bob Peel",
    username: "bob",
    avatarUrl: "https://avatars.githubusercontent.com/u/2",
  },
} as const;

export type UserKey = keyof typeof USERS;
