#!/usr/bin/env node
// Sweep orphaned uploads out of the `media` Storage bucket.
//
// An upload goes straight from the browser to the bucket before the peel
// exists (components/media-picker.tsx), so a picture attached and never posted,
// or one whose post was refused, stays behind; and a peel composted before the
// app learned to remove uploads on delete left its objects too. Every object in
// the bucket is a real upload (seeded media are external urls), so an object no
// peel_media row points at is an orphan -- unless it is younger than the grace
// period, because a composer may still be posting it.
//
//   node scripts/sweep-media.mjs --target local|live [--dry-run] [--min-age <minutes>]
//
// `--target local` reads the running local stack (`npx supabase start`);
// `--target live` reads .env.local or the environment (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY), which is how .github/workflows/sweep-media.yml
// runs it daily. Plain Node 22, no dependencies, one summary line, no key
// material in anything it prints.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** What every public url of the bucket contains, on any host. */
const MARKER = "/storage/v1/object/public/media/";
const PAGE = 1000;
const DELETE_BATCH = 100;

//------------------------------------------------------------------------------
// Arguments
//------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { target: undefined, dryRun: false, minAge: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") args.target = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--min-age") args.minAge = Number(argv[++i]);
    else die(`Unknown argument: ${a}`);
  }
  if (args.target !== "local" && args.target !== "live") die("Usage: node scripts/sweep-media.mjs --target local|live [--dry-run] [--min-age <minutes>]");
  if (!Number.isFinite(args.minAge) || args.minAge < 0) die("--min-age wants a number of minutes, 0 or more.");
  return args;
}

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
  const serviceKey = values.get("SERVICE_ROLE_KEY") ?? values.get("SECRET_KEY");
  if (!apiUrl || !serviceKey) die("Incomplete `supabase status -o env` output (no API_URL / SERVICE_ROLE_KEY).");
  return { apiUrl: apiUrl.replace(/\/$/, ""), serviceKey: keep(serviceKey) };
}

function loadLiveEnv() {
  const path = join(ROOT, ".env.local");
  const values = new Map();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      values.set(m[1], v);
    }
  }
  // .env.local first, then the plain environment: the workflow has no
  // .env.local, it has secrets exported into the job.
  const pick = (...names) => {
    for (const n of names) {
      const v = values.get(n) || process.env[n];
      if (v) return v;
    }
    return undefined;
  };
  const apiUrl = pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceKey = pick("SUPABASE_SERVICE_ROLE_KEY");
  const where = `${existsSync(path) ? ".env.local or " : ""}the environment`;
  if (!apiUrl) die(`--target live needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in ${where}.`);
  if (!serviceKey) die(`--target live needs SUPABASE_SERVICE_ROLE_KEY in ${where}. Refusing to run without it.`);
  return { apiUrl: apiUrl.replace(/\/$/, ""), serviceKey: keep(serviceKey) };
}

//------------------------------------------------------------------------------
// HTTP: one call, no retries. Any failure aborts the run, and an aborted run
// deletes nothing: an incomplete list of references must never become a list
// of things to delete.
//------------------------------------------------------------------------------

async function api(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      apikey: env.serviceKey,
      // Dropped by probeAuth() for a key the API refuses as a bearer token.
      ...(env.bearer === false ? {} : { Authorization: `Bearer ${env.serviceKey}` }),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${redact(text)}`);
  return text ? JSON.parse(text) : null;
}

/** Same two key formats as seed/seed.mjs: a JWT wants the bearer header, an sb_secret_… key may reject it. */
async function probeAuth(env) {
  const ping = () => api(env, "/rest/v1/peel_media?select=id&limit=1");
  try {
    await ping();
  } catch (error) {
    if (!/-> 401/.test(error.message) || env.bearer === false || !env.serviceKey.startsWith("sb_secret_")) throw error;
    env.bearer = false;
    await ping();
  }
}

//------------------------------------------------------------------------------
// The bucket and the table
//------------------------------------------------------------------------------

/** One level of the bucket: folder entries have no id, objects do. */
async function listLevel(env, prefix) {
  const entries = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await api(env, "/storage/v1/object/list/media", {
      method: "POST",
      body: { prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } },
    });
    entries.push(...page);
    if (page.length < PAGE) break;
  }
  return entries;
}

/** Every object in the bucket as { path, createdAt }. Uploads live one folder deep, `<uid>/<file>`. */
async function listObjects(env) {
  const folders = (await listLevel(env, "")).filter((e) => e.id === null).map((e) => e.name);
  const objects = [];
  for (const folder of folders) {
    for (const e of await listLevel(env, `${folder}/`)) {
      if (e.id === null) continue;
      objects.push({ path: `${folder}/${e.name}`, createdAt: Date.parse(e.created_at) });
    }
  }
  return { folders: folders.length, objects };
}

/**
 * The bucket paths some peel_media row points at. Matched on the marker alone,
 * whatever the host: a url that names another project can only protect an
 * object here, never delete one.
 */
async function referencedPaths(env) {
  const paths = new Set();
  const filter = `url=like.*${encodeURIComponent(MARKER)}*`;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await api(env, `/rest/v1/peel_media?select=url&${filter}&limit=${PAGE}&offset=${offset}`);
    for (const { url } of rows) {
      const at = url.indexOf(MARKER);
      if (at >= 0) paths.add(url.slice(at + MARKER.length).split(/[?#]/, 1)[0]);
    }
    if (rows.length < PAGE) break;
  }
  return paths;
}

//------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = args.target === "local" ? loadLocalEnv() : loadLiveEnv();
  await probeAuth(env);

  const { folders, objects } = await listObjects(env);
  const referenced = await referencedPaths(env);
  const cutoff = Date.now() - args.minAge * 60_000;

  let kept = 0;
  let young = 0;
  const orphans = [];
  for (const o of objects) {
    if (referenced.has(o.path)) kept++;
    else if (!(o.createdAt < cutoff)) young++;
    else orphans.push(o.path);
  }

  if (!args.dryRun) {
    for (let i = 0; i < orphans.length; i += DELETE_BATCH) {
      await api(env, "/storage/v1/object/media", { method: "DELETE", body: { prefixes: orphans.slice(i, i + DELETE_BATCH) } });
    }
  }
  console.log(
    `sweep-media${args.dryRun ? " (dry run)" : ""}: ${objects.length} objects in ${folders} folders, ` +
      `${kept} referenced, ${young} under ${args.minAge} min, ${orphans.length} orphans ${args.dryRun ? "would be deleted" : "deleted"}`,
  );
}

main().catch((error) => die(error.stack ?? error));
