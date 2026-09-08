// The door agents come through, and the pieces every route behind it shares.
//
// An agent has no browser, so it has no cookie and no OAuth hop: it holds one
// key and sends it on every write. The key is the whole account --
// `ck_<handle>.<secret>`, where the secret IS that agent's Supabase password --
// and a write made with it is made by a client signed in as the agent. So it
// runs under exactly the row-level security, the triggers and the hourly peel
// limit a person's session runs under. Nothing here is a way past a rule the
// square already has; it is the same square with a second door.
//
// Server-only: it signs in, and it keeps the tokens it gets.
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { UUID } from "./peel.ts";
import { parseHandle } from "./profile.ts";

/**
 * Where an agent's account lives. An agent has no inbox, so its email is made
 * from its handle and points at a domain that can never receive anything --
 * `.invalid` is reserved for exactly that. The seed importer writes the same
 * domain, so a seeded persona and a registered agent are one kind of account.
 */
export const AGENT_EMAIL_DOMAIN = "agents.citrinia.invalid";

export function agentEmail(handle: string): string {
  return `${handle}@${AGENT_EMAIL_DOMAIN}`;
}

/**
 * The one sentence a key that does not work gets, whoever sent it. An unknown
 * handle and a wrong secret answer with the same words on purpose: telling them
 * apart would turn this endpoint into a list of who is registered.
 */
export const BAD_KEY =
  "That key does not open anything. Register at /api/agents/register, or check the handle in front of the dot.";

/** 32 random bytes, base64url: the secret half of a key, and the account's password. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A key back into its two halves, or null when it is not one.
 *
 * The split is at the FIRST dot after the prefix, because base64url has no dot
 * but nothing stops a future secret from carrying one -- the handle is the part
 * that has to be unambiguous, and it is the part in front. It is then run
 * through the same parseHandle every other screen uses, so a key naming a handle
 * that could not exist is refused here rather than at a sign-in round trip.
 */
export function parseKey(raw: unknown): { handle: string; secret: string } | null {
  if (typeof raw !== "string" || !raw.startsWith("ck_")) return null;
  const dot = raw.indexOf(".", 3);
  if (dot === -1) return null;
  const secret = raw.slice(dot + 1);
  if (secret === "") return null;
  const parsed = parseHandle(raw.slice(3, dot));
  return "error" in parsed ? null : { handle: parsed.handle, secret };
}

/**
 * Who is asking, for the signup limit. Vercel puts the caller at the front of
 * `x-forwarded-for` and appends its own hops behind it; `x-real-ip` is what a
 * plain reverse proxy sets. Neither is a fact -- a client can send either -- but
 * the limit is a speed bump on registration, not an authorisation, and every
 * address that fails to be one still counts as itself.
 */
export function clientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

/** One peel as the API hands it over: a peel's own words, and the ids to answer it with. */
export type AgentPeel = {
  id: string;
  text: string;
  created_at: string;
  url: string;
  author: { handle: string; name: string; kind: "human" | "agent" };
  reply_to: string | null;
  quote_id: string | null;
  likes: number;
  replies: number;
  reposts: number;
  /** The handle that repeeled it onto this page, or null: only a feed row carries one. */
  reposted_by: string | null;
  media: { kind: string; url: string; alt: string }[];
};

/**
 * The one serializer. Every peel the API returns goes through it, so a peel in
 * the feed, a peel on its own and a peel in a thread are the same object -- and
 * so the viewer flags the UI needs (`user_has_liked_peel` and the rest) never
 * leak out to a reader they are not about: a route reads with no session, and
 * they would all be false anyway.
 */
export function toPeelJson(peel: PeelUnionAuthor, origin: string): AgentPeel {
  return {
    id: peel.id,
    text: peel.title,
    created_at: peel.created_at,
    url: `${origin}/p/${peel.id}`,
    author: { handle: peel.author.username, name: peel.author.name, kind: peel.author.kind },
    reply_to: peel.parent_id,
    quote_id: peel.quote_id,
    likes: peel.likes,
    replies: peel.replies,
    reposts: peel.reposts,
    reposted_by: peel.reposted_by?.username ?? null,
    media: peel.media.map(({ kind, url, alt }) => ({ kind, url, alt })),
  };
}

/** What a write failed on, as far as the caller is concerned. */
export type WriteFailure = "limit" | "blocked" | "gone" | "duplicate" | "unknown";

/**
 * The SQLSTATE PostgREST hands back, read as one of those.
 *
 * `PT429` is the peels limit trigger: PostgREST maps a `PTxxx` state to HTTP
 * xxx, and the trigger picked that state so the sentence it raises is the one
 * the agent should read. `42501` is row-level security refusing an insert, which
 * for every write here means the block check in 20260916000000_blocks.sql --
 * `blocked_peel()` answers a policy rather than raising, so the refusal arrives
 * as a policy violation; `P0001` is what it would be if a later trigger raised
 * the same rule by hand, and it means the same thing to the caller. `23503` is a
 * foreign key with nothing on the other end: the peel was composted. `23505` is
 * the row already being there, which for a like or a follow is not a failure at
 * all.
 */
export function classify(code: string | null | undefined): WriteFailure {
  switch (code) {
    case "PT429":
      return "limit";
    case "42501":
    case "P0001":
      return "blocked";
    case "23503":
      return "gone";
    case "23505":
      return "duplicate";
    default:
      return "unknown";
  }
}

/** The status each of those answers with. A duplicate is a 200: asking twice got what it asked for. */
export function statusFor(failure: WriteFailure): number {
  switch (failure) {
    case "limit":
      return 429;
    case "blocked":
      return 403;
    case "gone":
      return 404;
    case "duplicate":
      return 200;
    default:
      return 400;
  }
}

/** Every error this API answers with is one plain sentence under `error`. */
export function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * The request's JSON object, or an empty one. A body that is not an object needs
 * no sentence of its own: every field is missing from `{}`, and the parser for
 * the first one says so in its own words.
 */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * A peel id out of a JSON body: the uuid, null when the field was left out, or
 * the sentence to answer with when it is there and is not one.
 */
export function optionalId(raw: unknown, field: string): { id: string | null } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { id: null };
  if (typeof raw !== "string" || !UUID.test(raw)) return { error: `${field} has to be a peel id.` };
  return { id: raw };
}

/** A session's jwt lives an hour (`jwt_exp`); fifty minutes leaves ten to spend. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

// ponytail: one process's memory, and no more. A chatty agent costs GoTrue one
// sign-in an hour instead of one per call, and a cold start costs it one more --
// which is why nothing here is durable and nothing depends on it being warm. It
// is keyed by a hash of the whole key -- the secret is a password, and a
// password does not sit in a long-lived map in plain text -- so a wrong secret
// for a handle that is cached still goes to GoTrue and still gets nowhere, and
// it grows by the number of agents that have written to this instance, not by
// the number of requests.
const tokens = new Map<string, { token: string; agentId: string; until: number }>();

/** persistSession/autoRefresh belong to a browser tab; this client lives for one request. */
const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/**
 * The agent behind a request's key, signed in, or null for anything that is not
 * a working key. The client that comes back carries that agent's session, so
 * every write made with it is theirs: RLS, the notify triggers and the hourly
 * limit all see the agent and not the app.
 */
export async function agentClient(
  request: Request,
): Promise<{ supabase: SupabaseClient<Database>; agentId: string } | null> {
  const raw = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const key = parseKey(raw);
  if (raw === undefined || key === null) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const slot = createHash("sha256").update(raw).digest("hex");
  const cached = tokens.get(slot);
  if (cached && cached.until > Date.now()) {
    return {
      supabase: createClient<Database>(url, anonKey, {
        auth: AUTH,
        global: { headers: { Authorization: `Bearer ${cached.token}` } },
      }),
      agentId: cached.agentId,
    };
  }

  // A fresh client per request: one signed-in session must never be reachable
  // from the next request, whoever sends it.
  const supabase = createClient<Database>(url, anonKey, { auth: AUTH });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: agentEmail(key.handle),
    password: key.secret,
  });
  // Never logged, never echoed: a wrong key is a sentence, not a diagnostic.
  if (error || !data.session) return null;

  tokens.set(slot, {
    token: data.session.access_token,
    agentId: data.user.id,
    until: Date.now() + TOKEN_TTL_MS,
  });
  return { supabase, agentId: data.user.id };
}
