#!/usr/bin/env node
// Turns seed/content/*.json into real users and activity on a Supabase project.
//
//   node seed/seed.mjs --target local|live [--dry-run] [--only <cluster>]
//   node seed/seed.mjs --target local --wipe-local
//
// Plain Node, no dependencies. Designed for ~20k peels across ~300 personas:
// every write is a batch, every batch is idempotent (ON CONFLICT DO NOTHING),
// and peel uuids are derived from the content id, so an interrupted run resumes
// and a repeat run inserts nothing.
//
// Keys are read from the running stack (local) or .env.local (live) and are
// never printed: everything that reaches stdout/stderr goes through redact().
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(HERE, "content");
const STATE_DIR = join(HERE, ".state");
const ROOT = join(HERE, "..");

// Batch sizes. Peels are the widest rows, so they go in smaller batches.
const PEEL_BATCH = 200;
const MEDIA_BATCH = 200;
const EDGE_BATCH = 500;
const USERS_PER_SECOND = 5;
const HTTP_TIMEOUT_MS = 60_000;
const HTTP_RETRIES = 5;

const AVATAR_BASE = "https://api.dicebear.com/9.x";
const EMAIL_DOMAIN = "agents.citrinia.invalid";

//------------------------------------------------------------------------------
// CLI
//------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { target: null, dryRun: false, only: [], wipeLocal: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = argv[++i];
    else if (a.startsWith("--target=")) out.target = a.slice(9);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--wipe-local") out.wipeLocal = true;
    else if (a === "--only") out.only.push(argv[++i]);
    else if (a.startsWith("--only=")) out.only.push(a.slice(7));
    else if (a === "--help" || a === "-h") out.help = true;
    else die(`unknown argument: ${a}\n${USAGE}`);
  }
  return out;
}

const USAGE = `usage: node seed/seed.mjs --target local|live [--dry-run] [--only <cluster>]
       node seed/seed.mjs --target local --wipe-local

  --target local   read API url + service_role key from \`npx supabase status -o env\`
  --target live    read NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
  --dry-run        validate, resolve credentials and print the plan; write nothing
  --only <cluster> restrict to one content file (repeatable)
  --wipe-local     delete every seeded auth user (cascades all their rows); local only`;

function die(msg) {
  console.error(redact(String(msg)));
  process.exit(1);
}

//------------------------------------------------------------------------------
// Secrets: held in one place, scrubbed out of everything printed.
//------------------------------------------------------------------------------

const SECRETS = new Set();
function keep(secret) {
  if (secret) SECRETS.add(secret);
  return secret;
}
function redact(text) {
  let out = String(text);
  for (const s of SECRETS) if (s.length > 8) out = out.split(s).join("«redacted»");
  return out;
}
const log = (...args) => console.log(redact(args.join(" ")));

function loadLocalEnv() {
  let raw;
  try {
    raw = execFileSync("npx", ["supabase@latest", "status", "-o", "env"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    die(`Could not read the local Supabase status. Start it with \`npx supabase start\` first.\n${error}`);
  }
  const values = new Map();
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (m) values.set(m[1], m[2]);
  }
  const apiUrl = values.get("API_URL");
  // A JWT service_role key is preferred over the newer sb_secret_… form: only the
  // JWT makes PostgREST set request.jwt.claims, which seed_triggers() checks.
  const serviceKey = values.get("SERVICE_ROLE_KEY") ?? values.get("SECRET_KEY");
  const anonKey = values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
  if (!apiUrl || !serviceKey) die("Incomplete `supabase status -o env` output (no API_URL / SERVICE_ROLE_KEY).");
  return { apiUrl: apiUrl.replace(/\/$/, ""), serviceKey: keep(serviceKey), anonKey: keep(anonKey) };
}

function loadLiveEnv() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) die(`--target live needs ${path}, which does not exist.`);
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    values.set(m[1], v);
  }
  const apiUrl = values.get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = values.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = values.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? values.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!apiUrl) die("--target live needs NEXT_PUBLIC_SUPABASE_URL in .env.local.");
  if (!serviceKey) die("--target live needs SUPABASE_SERVICE_ROLE_KEY in .env.local. Refusing to run without it.");
  return { apiUrl: apiUrl.replace(/\/$/, ""), serviceKey: keep(serviceKey), anonKey: keep(anonKey) };
}

//------------------------------------------------------------------------------
// HTTP: one wrapper, retries on 429/5xx, stops on 4xx with the body printed.
//------------------------------------------------------------------------------

let requestCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status}\n${body}`);
    this.status = status;
  }
}

async function api(env, path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const url = `${env.apiUrl}${path}`;
  let lastError;
  for (let attempt = 0; attempt <= HTTP_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    requestCount++;
    let res;
    try {
      res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          apikey: env.serviceKey,
          Authorization: `Bearer ${env.serviceKey}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === HTTP_RETRIES) throw new Error(`${method} ${path} failed after ${attempt + 1} tries: ${error.message}`);
      await sleep(backoff(attempt));
      continue;
    }
    clearTimeout(timer);

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const text = await res.text().catch(() => "");
      lastError = new HttpError(method, path, res.status, text);
      if (attempt === HTTP_RETRIES) throw lastError;
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      continue;
    }
    if (!res.ok) throw new HttpError(method, path, res.status, await res.text().catch(() => ""));
    if (raw) return res;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  throw lastError;
}

const backoff = (attempt) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

/**
 * POST rows and return the rows the database actually wrote. With
 * `resolution=ignore-duplicates` PostgREST emits ON CONFLICT DO NOTHING, so the
 * representation contains only genuinely new rows — that is where "N new" comes
 * from, and why a re-run can honestly report zero.
 */
async function insertBatch(env, table, rows, { onConflict, select = "id", merge = false } = {}) {
  if (!rows.length) return [];
  const query = new URLSearchParams();
  if (onConflict) query.set("on_conflict", onConflict);
  query.set("select", select);
  const inserted = await api(env, `/rest/v1/${table}?${query}`, {
    method: "POST",
    body: rows,
    headers: {
      Prefer: `return=representation,resolution=${merge ? "merge-duplicates" : "ignore-duplicates"}`,
    },
  });
  return Array.isArray(inserted) ? inserted : [];
}

async function insertAll(env, table, rows, size, opts) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    inserted += (await insertBatch(env, table, rows.slice(i, i + size), opts)).length;
  }
  return inserted;
}

//------------------------------------------------------------------------------
// Deterministic ids and PRNG
//------------------------------------------------------------------------------

const NAMESPACE = "citrinia-seed-v1";

/** A stable uuid for a content id, so re-runs address the same row without a lookup. */
function uuidFor(contentId) {
  const h = createHash("sha256").update(`${NAMESPACE}:${contentId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4 shape, so anything reading it sees a normal uuid
  b[8] = (b[8] & 0x3f) | 0x80;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** mulberry32 seeded from a string: same label, same stream, every run. */
function rngFor(label) {
  let a = createHash("sha256").update(`${NAMESPACE}:rng:${label}`).digest().readUInt32LE(0);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//------------------------------------------------------------------------------
// Content
//------------------------------------------------------------------------------

function runValidator() {
  // No file arguments means "all of seed/content", which is what checks that
  // handles and ids are unique across clusters. --only still validates everything.
  const r = spawnSync(process.execPath, [join(HERE, "validate.mjs")], { cwd: ROOT, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? "");
    die("validate.mjs failed; nothing was written.");
  }
}

function loadContent(only) {
  const names = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
  const wanted = only.length ? only : names;
  for (const c of wanted) if (!names.includes(c)) die(`--only ${c}: no seed/content/${c}.json (have: ${names.join(", ")})`);
  return wanted.map((name) => {
    const doc = JSON.parse(readFileSync(join(CONTENT_DIR, `${name}.json`), "utf8"));
    return { ...doc, cluster: doc.cluster ?? name, file: `${name}.json` };
  });
}

const avatarUrl = (p) => `${AVATAR_BASE}/${p.avatar_style}/svg?seed=${encodeURIComponent(p.avatar_seed)}`;
const emailFor = (handle) => `${handle}@${EMAIL_DOMAIN}`;
const password = () => `Pl-${randomUUID()}`;

//------------------------------------------------------------------------------
// Plan: everything the run will write, computed before anything is written.
//------------------------------------------------------------------------------

function buildPlan(docs, nowMs) {
  const personas = [];
  const byHandle = new Map();
  for (const doc of docs) {
    for (const p of doc.personas) {
      const persona = { ...p, cluster: doc.cluster, avatar_url: avatarUrl(p) };
      personas.push(persona);
      byHandle.set(p.handle, persona);
    }
  }
  personas.sort((a, b) => (a.handle < b.handle ? -1 : 1));

  // --- peels (top-level, quotes and replies all land in one table) ---
  const peels = [];
  const media = [];
  const reposts = [];
  const at = (ageHours) => new Date(nowMs - ageHours * 3_600_000).toISOString();

  for (const doc of docs) {
    const pushMedia = (contentId, x) => {
      if (!Array.isArray(x.media)) return;
      x.media.forEach((m, i) => {
        media.push({
          peel_id: uuidFor(contentId),
          position: i,
          kind: m.kind,
          url: m.url,
          alt: m.kind === "image" || m.kind === "gif" ? String(m.alt ?? "") : "",
        });
      });
    };
    for (const p of doc.peels) {
      peels.push({
        id: uuidFor(p.id),
        title: p.text,
        user_id: byHandle.get(p.by).handle, // swapped for a uuid once users exist
        created_at: at(p.age_hours),
        parent_id: null,
        quote_id: p.quote ? uuidFor(p.quote) : null,
        _contentId: p.id,
        _cluster: doc.cluster,
        _kind: p.quote ? "quote" : "peel",
      });
      pushMedia(p.id, p);
    }
    for (const r of doc.replies ?? []) {
      peels.push({
        id: uuidFor(r.id),
        title: r.text,
        user_id: byHandle.get(r.by).handle,
        created_at: at(r.age_hours),
        parent_id: uuidFor(r.to),
        quote_id: null,
        _contentId: r.id,
        _cluster: doc.cluster,
        _kind: "reply",
      });
      pushMedia(r.id, r);
    }
    for (const rp of doc.reposts ?? []) {
      reposts.push({
        user_id: byHandle.get(rp.by).handle,
        peel_id: uuidFor(rp.peel),
        created_at: at(rp.age_hours),
        _cluster: doc.cluster,
      });
    }
  }
  // Ascending created_at: a parent or quoted peel is always inserted before the
  // row that points at it, so the foreign keys hold without a second pass.
  peels.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  // Writers reuse round age_hours values, so many peels would share a timestamp. The
  // app pages with a strict `created_at <` cursor, and a tie on a page boundary would
  // hide the second row; nudge ties forward by 1 ms each (order and all "younger than"
  // relationships are preserved because ties only exist between unrelated rows).
  let lastMs = -Infinity;
  for (const peel of peels) {
    let ms = Date.parse(peel.created_at);
    if (ms <= lastMs) ms = lastMs + 1;
    peel.created_at = new Date(ms).toISOString();
    lastMs = ms;
  }

  // --- follows: 5-15 per persona, 70% inside the cluster ---
  const clusters = new Map();
  for (const p of personas) {
    if (!clusters.has(p.cluster)) clusters.set(p.cluster, []);
    clusters.get(p.cluster).push(p);
  }
  const follows = [];
  const followersOf = new Map(personas.map((p) => [p.handle, new Set()]));
  for (const p of personas) {
    const rnd = rngFor(`follows:${p.handle}`);
    const inside = clusters.get(p.cluster).filter((o) => o.handle !== p.handle);
    const outside = personas.filter((o) => o.cluster !== p.cluster);
    const want = Math.min(5 + Math.floor(rnd() * 11), personas.length - 1);
    const picked = new Set();
    for (let guard = 0; picked.size < want && guard < want * 20; guard++) {
      // 70% inside the cluster, 30% across it; whichever side is empty falls back
      // to the other so a single-cluster run still builds a graph.
      const preferInside = rnd() < 0.7;
      const pool = preferInside ? (inside.length ? inside : outside) : outside.length ? outside : inside;
      if (!pool.length) break;
      const target = pool[Math.floor(rnd() * pool.length)];
      if (!target || target.handle === p.handle) continue;
      picked.add(target.handle);
    }
    for (const h of picked) {
      follows.push({
        follower_id: p.handle,
        followee_id: h,
        // Spread over the same three weeks the content covers.
        created_at: new Date(nowMs - (1 + rnd() * 500) * 3_600_000).toISOString(),
        _cluster: p.cluster,
      });
      followersOf.get(h).add(p.handle);
    }
  }

  // --- likes: power law per peel, likers weighted to followers and cluster mates ---
  // One weighted pool per author, reused across that author's peels: at 20k peels
  // rebuilding it per row is the difference between seconds and minutes.
  const poolFor = new Map();
  for (const author of personas) {
    const followers = followersOf.get(author.handle);
    const pool = [];
    let total = 0;
    for (const cand of personas) {
      if (cand.handle === author.handle) continue;
      const w = followers.has(cand.handle) ? 6 : cand.cluster === author.cluster ? 3 : 1;
      total += w;
      pool.push({ handle: cand.handle, w });
    }
    poolFor.set(author.handle, { pool, total });
  }

  const likes = [];
  for (const peel of peels) {
    const rnd = rngFor(`likes:${peel._contentId}`);
    // Pareto tail: about half get 0, most of the rest 1-3, a few dozens.
    const heavy = Math.floor(Math.pow(1 - rnd() * 0.999, -1 / 1.35)) - 1;
    const scaled = peel._kind === "reply" ? Math.floor(heavy * 0.4) : heavy;
    const want = Math.max(0, Math.min(scaled, personas.length - 1, 60));
    if (!want) continue;
    const { pool, total: poolTotal } = poolFor.get(peel.user_id);
    let total = poolTotal;
    const taken = new Set();
    const peelMs = Date.parse(peel.created_at);
    const span = Math.max(60_000, nowMs - peelMs);
    for (let n = 0; n < want && taken.size < pool.length; n++) {
      let target = rnd() * total;
      let chosen = null;
      for (const c of pool) {
        if (taken.has(c.handle)) continue;
        target -= c.w;
        if (target <= 0) { chosen = c; break; }
      }
      if (!chosen) chosen = pool.find((c) => !taken.has(c.handle));
      if (!chosen) break;
      taken.add(chosen.handle);
      total -= chosen.w;
      likes.push({
        user_id: chosen.handle,
        peel_id: peel.id,
        // Squared so most likes land soon after the peel rather than uniformly.
        created_at: new Date(peelMs + Math.pow(rnd(), 2) * span).toISOString(),
        _cluster: peel._cluster,
      });
    }
  }

  // --- bookmarks: ~15 per cluster, private, no notifications ---
  const bookmarks = [];
  // Picked positionally, so the list they index into has to be stable: a
  // cluster's own top-level peels, ordered by content id. Indexing into the
  // whole corpus sorted by time (the obvious version) makes an edit to one
  // content file silently reshuffle every other cluster's bookmarks.
  const bookmarkable = new Map();
  for (const p of peels) {
    if (p._kind === "reply") continue;
    if (!bookmarkable.has(p._cluster)) bookmarkable.set(p._cluster, []);
    bookmarkable.get(p._cluster).push(p);
  }
  for (const list of bookmarkable.values()) list.sort((a, b) => (a._contentId < b._contentId ? -1 : 1));

  for (const [cluster, members] of clusters) {
    const rnd = rngFor(`bookmarks:${cluster}`);
    const candidates = bookmarkable.get(cluster) ?? [];
    const seen = new Set();
    for (let i = 0; i < 15 && candidates.length; i++) {
      const who = members[Math.floor(rnd() * members.length)];
      const what = candidates[Math.floor(rnd() * candidates.length)];
      const key = `${who.handle}|${what.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const peelMs = Date.parse(what.created_at);
      bookmarks.push({
        user_id: who.handle,
        peel_id: what.id,
        created_at: new Date(peelMs + rnd() * Math.max(60_000, nowMs - peelMs)).toISOString(),
        _cluster: cluster,
      });
    }
  }

  return { personas, byHandle, clusters, peels, media, reposts, follows, likes, bookmarks };
}

//------------------------------------------------------------------------------
// State
//------------------------------------------------------------------------------

function statePath(target) {
  return join(STATE_DIR, `${target}.json`);
}

function loadState(target) {
  const path = statePath(target);
  if (!existsSync(path)) return { version: 1, target, users: {}, peels: {}, sections: {} };
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return { version: 1, target, users: {}, peels: {}, sections: {}, ...s };
  } catch {
    return { version: 1, target, users: {}, peels: {}, sections: {} };
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  const path = statePath(state.target);
  const tmp = `${path}.tmp`;
  state.updatedAt = new Date().toISOString();
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, path); // atomic: an interrupted write never leaves half a state file
}

//------------------------------------------------------------------------------
// Users
//------------------------------------------------------------------------------

let authUserCache = null;
/** Last resort for a persona whose auth user exists but whose profile row does not. */
async function authUserByEmail(env, email) {
  if (!authUserCache) {
    authUserCache = new Map();
    for (let page = 1; page <= 100; page++) {
      const body = await api(env, `/auth/v1/admin/users?page=${page}&per_page=200`);
      const users = body?.users ?? [];
      for (const u of users) if (u.email) authUserCache.set(u.email.toLowerCase(), u.id);
      if (users.length < 200) break;
    }
  }
  return authUserCache.get(email.toLowerCase()) ?? null;
}

async function ensureUsers(env, plan, state) {
  const handles = plan.personas.map((p) => p.handle);
  const known = new Map();
  for (const [handle, rec] of Object.entries(state.users)) if (rec?.id) known.set(handle, rec.id);

  // One request per 200 handles instead of one lookup per persona.
  const missingLookup = handles.filter((h) => !known.has(h));
  for (let i = 0; i < missingLookup.length; i += 200) {
    const chunk = missingLookup.slice(i, i + 200);
    const list = chunk.map((h) => `"${h}"`).join(",");
    const rows = await api(env, `/rest/v1/profiles?select=id,username&username=in.(${list})`);
    for (const row of rows ?? []) known.set(row.username, row.id);
  }

  let created = 0;
  let reused = 0;
  let reset = 0;
  const gap = 1000 / USERS_PER_SECOND;
  for (const persona of plan.personas) {
    if (known.has(persona.handle)) {
      reused++;
      const existing = state.users[persona.handle] ?? {};
      const id = known.get(persona.handle);
      // A run that lost its state file reuses the auth user but no longer knows
      // its password, and nothing could ever sign in as that persona again.
      // Give it a fresh one so the accounts stay usable.
      if (!existing.password) {
        const started = Date.now();
        const pw = password();
        await api(env, `/auth/v1/admin/users/${id}`, { method: "PUT", body: { password: pw } });
        existing.password = pw;
        reset++;
        const wait = gap - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
      state.users[persona.handle] = { ...existing, id, email: emailFor(persona.handle) };
      if (reset && reset % 25 === 0) saveState(state);
      continue;
    }
    const started = Date.now();
    const pw = state.users[persona.handle]?.password ?? password();
    let id = null;
    try {
      const user = await api(env, "/auth/v1/admin/users", {
        method: "POST",
        body: {
          email: emailFor(persona.handle),
          password: pw,
          email_confirm: true,
          // The signup trigger reads exactly these three keys.
          user_metadata: { name: persona.name, user_name: persona.handle, avatar_url: persona.avatar_url },
        },
      });
      id = user?.id ?? null;
      created++;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
      if (!/already|registered|exists/i.test(error.message)) throw error;
      const rows = await api(env, `/rest/v1/profiles?select=id&username=eq.${encodeURIComponent(persona.handle)}`);
      id = rows?.[0]?.id ?? (await authUserByEmail(env, emailFor(persona.handle)));
      if (!id) throw error;
      reused++;
    }
    state.users[persona.handle] = { id, email: emailFor(persona.handle), password: pw };
    if (created % 25 === 0) saveState(state);
    const wait = gap - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  saveState(state);

  // The trigger runs after the insert; make sure every profile actually landed.
  const ids = plan.personas.map((p) => state.users[p.handle]?.id).filter(Boolean);
  if (ids.length !== plan.personas.length) {
    const lost = plan.personas.filter((p) => !state.users[p.handle]?.id).map((p) => p.handle);
    throw new Error(`no auth user for: ${lost.join(", ")}`);
  }
  return { created, reused, reset };
}

/** Bios (and name/avatar, so a re-run heals drift) in batches rather than a PATCH per row. */
async function upsertProfiles(env, plan, state) {
  const rows = plan.personas.map((p) => ({
    id: state.users[p.handle].id,
    name: p.name,
    username: p.handle,
    avatar_url: p.avatar_url,
    bio: p.bio,
  }));
  let n = 0;
  for (let i = 0; i < rows.length; i += PEEL_BATCH) {
    n += (await insertBatch(env, "profiles", rows.slice(i, i + PEEL_BATCH), {
      onConflict: "id",
      select: "id",
      merge: true,
    })).length;
  }
  return n;
}

//------------------------------------------------------------------------------
// Wipe (local only)
//------------------------------------------------------------------------------

async function wipeLocal(env, plan, state) {
  const ids = new Map();
  for (const p of plan.personas) {
    const known = state.users[p.handle]?.id;
    if (known) ids.set(p.handle, known);
  }
  const handles = plan.personas.map((p) => p.handle);
  for (let i = 0; i < handles.length; i += 200) {
    const list = handles.slice(i, i + 200).map((h) => `"${h}"`).join(",");
    const rows = await api(env, `/rest/v1/profiles?select=id,username&username=in.(${list})`);
    for (const row of rows ?? []) ids.set(row.username, row.id);
  }
  let deleted = 0;
  for (const [handle, id] of ids) {
    try {
      await api(env, `/auth/v1/admin/users/${id}`, { method: "DELETE" });
      deleted++;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw new Error(`could not delete @${handle}: ${error.message}`);
    }
  }
  rmSync(statePath(state.target), { force: true });
  log(`wiped ${deleted} seeded user(s); ${statePath(state.target)} removed`);
}

//------------------------------------------------------------------------------
// Main
//------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return log(USAGE);
  if (args.target !== "local" && args.target !== "live") die(`--target must be local or live\n${USAGE}`);
  if (args.wipeLocal && args.target !== "local") die("--wipe-local refuses to run against a live project.");

  const startedAt = Date.now();
  log(`# citrinia seed — target ${args.target}${args.dryRun ? " (dry run)" : ""}`);

  // Credentials first, dry run included: a plan that cannot be applied is not a
  // useful rehearsal, and this is where a missing service_role key is refused.
  const env = args.target === "local" ? loadLocalEnv() : loadLiveEnv();

  log("\n## validating content");
  runValidator();
  const docs = loadContent(args.only);
  const nowMs = Date.now();
  const plan = buildPlan(docs, nowMs);

  const replies = plan.peels.filter((p) => p._kind === "reply").length;
  const quotes = plan.peels.filter((p) => p._kind === "quote").length;
  const clusterOfPeel = new Map(plan.peels.map((p) => [p.id, p._cluster]));
  const tally = (rows, pick) => {
    const counts = new Map();
    for (const r of rows) {
      const c = pick(r);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  };
  const mediaByCluster = tally(plan.media, (m) => clusterOfPeel.get(m.peel_id));
  const repostsByCluster = tally(plan.reposts, (r) => r._cluster);
  const followsByCluster = tally(plan.follows, (f) => f._cluster);
  const likesByCluster = tally(plan.likes, (l) => l._cluster);
  const bookmarksByCluster = tally(plan.bookmarks, (b) => b._cluster);
  const peelsByCluster = new Map();
  for (const p of plan.peels) {
    if (!peelsByCluster.has(p._cluster)) peelsByCluster.set(p._cluster, { peel: 0, reply: 0, quote: 0 });
    const bucket = peelsByCluster.get(p._cluster);
    bucket[p._kind]++;
  }

  log("\n## plan");
  log(pad("cluster", 12) + pad("personas", 10) + pad("peels", 8) + pad("replies", 9) + pad("quotes", 8) + pad("media", 7) + pad("reposts", 9) + pad("follows", 9) + pad("likes", 8) + "bookmarks");
  for (const doc of docs) {
    const c = doc.cluster;
    const b = peelsByCluster.get(c) ?? { peel: 0, reply: 0, quote: 0 };
    log(
      pad(c, 12) +
        pad(plan.clusters.get(c)?.length ?? 0, 10) +
        pad(b.peel + b.quote, 8) +
        pad(b.reply, 9) +
        pad(b.quote, 8) +
        pad(mediaByCluster.get(c) ?? 0, 7) +
        pad(repostsByCluster.get(c) ?? 0, 9) +
        pad(followsByCluster.get(c) ?? 0, 9) +
        pad(likesByCluster.get(c) ?? 0, 8) +
        (bookmarksByCluster.get(c) ?? 0),
    );
  }
  log(
    pad("TOTAL", 12) +
      pad(plan.personas.length, 10) +
      pad(plan.peels.length - replies, 8) +
      pad(replies, 9) +
      pad(quotes, 8) +
      pad(plan.media.length, 7) +
      pad(plan.reposts.length, 9) +
      pad(plan.follows.length, 9) +
      pad(plan.likes.length, 8) +
      plan.bookmarks.length,
  );
  log(`\nusers to create-or-reuse: ${plan.personas.length}`);
  log(`rows to insert: ${plan.peels.length + plan.media.length + plan.reposts.length + plan.follows.length + plan.likes.length + plan.bookmarks.length}`);

  if (args.dryRun) {
    log(`\napi: ${env.apiUrl}`);
    log("dry run — nothing written.");
    return;
  }

  const state = loadState(args.target);
  log(`\napi: ${env.apiUrl}`);

  if (args.wipeLocal) return wipeLocal(env, plan, state);

  const stats = { usersCreated: 0, usersReused: 0, profiles: 0, peels: 0, replies: 0, quotes: 0, media: 0, reposts: 0, likes: 0, follows: 0, bookmarks: 0 };
  let triggersPaused = false;
  try {
    log("\n## users");
    const users = await ensureUsers(env, plan, state);
    stats.usersCreated = users.created;
    stats.usersReused = users.reused;
    log(`created ${users.created}, reused ${users.reused}${users.reset ? `, password reset for ${users.reset} (state had none)` : ""}`);
    stats.profiles = await upsertProfiles(env, plan, state);
    log(`profiles upserted (bio, name, avatar): ${stats.profiles}`);

    const uid = (handle) => state.users[handle].id;

    log("\n## pausing notification triggers");
    await api(env, "/rest/v1/rpc/seed_triggers", { method: "POST", body: { enabled: false } });
    triggersPaused = true;

    // ---- peels ----
    const section = (name) => state.sections[name] === true;
    const done = (name) => { state.sections[name] = true; saveState(state); };
    // Follows, likes and bookmarks are generated from the personas that happen to
    // be loaded, so `--only tech` builds a smaller graph than a full run. Tagging
    // those sections with the cluster scope means a later full run recomputes and
    // fills in the edges the narrow run could not see, instead of calling it done.
    const scope = createHash("sha256").update(docs.map((d) => d.cluster).sort().join(",")).digest("hex").slice(0, 8);

    for (const doc of docs) {
      const key = `peels:${doc.cluster}`;
      const rows = plan.peels.filter((p) => p._cluster === doc.cluster);
      if (section(key)) { log(`peels:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const kindOf = new Map(rows.map((p) => [p.id, p._kind]));
      let n = 0;
      for (let i = 0; i < rows.length; i += PEEL_BATCH) {
        const slice = rows.slice(i, i + PEEL_BATCH);
        const written = await insertBatch(
          env,
          "peels",
          slice.map((p) => ({
            id: p.id,
            title: p.title,
            user_id: uid(p.user_id),
            created_at: p.created_at,
            parent_id: p.parent_id,
            quote_id: p.quote_id,
          })),
          { onConflict: "id", select: "id" },
        );
        n += written.length;
        // Counted from what came back, so a re-run's zero is a real zero.
        for (const row of written) {
          if (kindOf.get(row.id) === "reply") stats.replies++;
          else if (kindOf.get(row.id) === "quote") stats.quotes++;
        }
        for (const p of slice) state.peels[p._contentId] = p.id;
      }
      stats.peels += n;
      log(`peels:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    // ---- media ----
    for (const doc of docs) {
      const key = `media:${doc.cluster}`;
      const ids = new Set(plan.peels.filter((p) => p._cluster === doc.cluster).map((p) => p.id));
      const rows = plan.media.filter((m) => ids.has(m.peel_id));
      if (!rows.length) continue;
      if (section(key)) { log(`media:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const n = await insertAll(env, "peel_media", rows, MEDIA_BATCH, { onConflict: "peel_id,position", select: "id" });
      stats.media += n;
      log(`media:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    // ---- reposts ----
    for (const doc of docs) {
      const key = `reposts:${doc.cluster}`;
      const rows = plan.reposts.filter((r) => r._cluster === doc.cluster);
      if (!rows.length) continue;
      if (section(key)) { log(`reposts:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const n = await insertAll(
        env,
        "reposts",
        rows.map((r) => ({ user_id: uid(r.user_id), peel_id: r.peel_id, created_at: r.created_at })),
        EDGE_BATCH,
        { onConflict: "user_id,peel_id", select: "peel_id" },
      );
      stats.reposts += n;
      log(`reposts:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    // ---- follows ----
    for (const doc of docs) {
      const key = `follows:${doc.cluster}@${scope}`;
      const rows = plan.follows.filter((f) => f._cluster === doc.cluster);
      if (!rows.length) continue;
      if (section(key)) { log(`follows:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const n = await insertAll(
        env,
        "follows",
        rows.map((f) => ({ follower_id: uid(f.follower_id), followee_id: uid(f.followee_id), created_at: f.created_at })),
        EDGE_BATCH,
        { onConflict: "follower_id,followee_id", select: "follower_id" },
      );
      stats.follows += n;
      log(`follows:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    // ---- likes ----
    for (const doc of docs) {
      const key = `likes:${doc.cluster}@${scope}`;
      const rows = plan.likes.filter((l) => l._cluster === doc.cluster);
      if (!rows.length) continue;
      if (section(key)) { log(`likes:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const n = await insertAll(
        env,
        "likes",
        rows.map((l) => ({ user_id: uid(l.user_id), peel_id: l.peel_id, created_at: l.created_at })),
        EDGE_BATCH,
        { onConflict: "user_id,peel_id", select: "id" },
      );
      stats.likes += n;
      log(`likes:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    // ---- bookmarks ----
    for (const doc of docs) {
      const key = `bookmarks:${doc.cluster}@${scope}`;
      const rows = plan.bookmarks.filter((b) => b._cluster === doc.cluster);
      if (!rows.length) continue;
      if (section(key)) { log(`bookmarks:${doc.cluster} — already done (${rows.length} rows)`); continue; }
      const n = await insertAll(
        env,
        "bookmarks",
        rows.map((b) => ({ user_id: uid(b.user_id), peel_id: b.peel_id, created_at: b.created_at })),
        EDGE_BATCH,
        { onConflict: "user_id,peel_id", select: "peel_id" },
      );
      stats.bookmarks += n;
      log(`bookmarks:${doc.cluster} — ${n} new of ${rows.length}`);
      done(key);
    }

    saveState(state);
  } finally {
    if (triggersPaused) {
      try {
        await api(env, "/rest/v1/rpc/seed_triggers", { method: "POST", body: { enabled: true } });
        log("\nnotification triggers re-enabled");
      } catch (error) {
        console.error(redact(`WARNING: could not re-enable notification triggers: ${error.message}`));
        console.error("Run: select public.seed_triggers(true); as the service role.");
      }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log("\n## summary");
  const row = (k, v) => log(pad(k, 22) + v);
  row("users created", stats.usersCreated);
  row("users reused", stats.usersReused);
  row("profiles upserted", stats.profiles);
  row("peels inserted", stats.peels);
  row("  of which replies", stats.replies);
  row("  of which quotes", stats.quotes);
  row("media inserted", stats.media);
  row("reposts inserted", stats.reposts);
  row("likes inserted", stats.likes);
  row("follows inserted", stats.follows);
  row("bookmarks inserted", stats.bookmarks);
  row("http requests", requestCount);
  row("elapsed", `${elapsed}s`);
  row("state", statePath(args.target));
}

function pad(v, n) {
  const s = String(v);
  return s.length >= n ? `${s} ` : s + " ".repeat(n - s.length);
}

// Importable for seed.test.mjs; only the CLI entry point actually runs.
export { buildPlan, loadContent, uuidFor };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(redact(`\nFAILED: ${error.message}`));
    process.exit(1);
  });
}
