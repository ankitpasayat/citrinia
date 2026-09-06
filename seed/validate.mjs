#!/usr/bin/env node
// Validates seed content files (seed/content/*.json) against the app's rules
// before anything is written to a database. Usage: node seed/validate.mjs [file ...]
// With no args, validates every file in seed/content and reports the combined totals.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_TITLE = 280;
const MAX_BIO = 160;
const MAX_NAME = 50;
const HANDLE = /^[a-z0-9_]{3,20}$/;
const AVATAR_STYLES = new Set(["bottts-neutral", "bottts", "shapes", "icons", "thumbs", "notionists-neutral"]);

const chars = (s) => Array.from(s).length;
const MEDIA_KINDS = new Set(["image", "gif", "video", "youtube"]);
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]{11}|youtu\.be\/[\w-]{11})/;
const CHECK_URLS = process.argv.includes("--check-urls");
const urlChecks = [];

function checkMedia(kind, x, err) {
  if (x.media === undefined) return;
  if (!Array.isArray(x.media) || x.media.length === 0 || x.media.length > 4) return err(`${kind} ${x.id}: media must be an array of 1..4 items`);
  const kinds = new Set(x.media.map((m) => m?.kind));
  if (x.media.length > 1 && (kinds.has("video") || kinds.has("youtube"))) err(`${kind} ${x.id}: a video or youtube attachment must be the only attachment`);
  for (const m of x.media) {
    if (!MEDIA_KINDS.has(m?.kind)) { err(`${kind} ${x.id}: media kind must be image|gif|video|youtube`); continue; }
    if (typeof m.url !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(m.url)) { err(`${kind} ${x.id}: media url must be an https URL`); continue; }
    if (m.kind === "youtube") {
      if (!YOUTUBE.test(m.url)) err(`${kind} ${x.id}: youtube url must be a watch or youtu.be URL`);
      continue;
    }
    if ((m.kind === "image" || m.kind === "gif") && (typeof m.alt !== "string" || !m.alt.trim() || chars(m.alt) > 200)) err(`${kind} ${x.id}: image/gif media needs alt text (1..200 chars)`);
    if (CHECK_URLS) urlChecks.push({ id: x.id, kind: m.kind, url: m.url });
  }
}

// URL checks: sequential per host with a polite delay, browser-like headers, 429/5xx
// retries with backoff, and a cache of verified URLs so re-runs and later batches
// never refetch what already passed.
import { existsSync, writeFileSync } from "node:fs";
const CACHE_PATH = join(HERE, ".urlcache.json");
const HOST_DELAY_MS = { "upload.wikimedia.org": 1500, default: 300 };
const HEADERS = {
  // Wikimedia's policy asks for an identifying agent with contact info; a spoofed browser UA gets throttled after a few requests.
  "user-agent": "citrinia-seed-validator/1.0 (https://github.com/ankitpasayat/citrinia; media link checker)",
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: HEADERS });
      if (res.status === 405 || res.status === 403 || res.status === 404) {
        res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { ...HEADERS, range: "bytes=0-0" } });
      }
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * (attempt + 1));
        continue;
      }
      return { ok: res.ok, status: res.status, type: res.headers.get("content-type") ?? "" };
    } catch (e) {
      clearTimeout(t);
      if (attempt === 3) return { ok: false, status: 0, type: String(e.message) };
      await sleep(2000 * (attempt + 1));
    }
  }
  return { ok: false, status: 429, type: "rate limited after retries" };
}

async function verifyUrls() {
  let cache = {};
  if (existsSync(CACHE_PATH)) { try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch { cache = {}; } }
  const byHost = new Map();
  for (const c of urlChecks) {
    const host = new URL(c.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(c);
  }
  const results = new Map();
  await Promise.all([...byHost.entries()].map(async ([host, items]) => {
    const delay = HOST_DELAY_MS[host] ?? HOST_DELAY_MS.default;
    for (const { url } of items) {
      if (results.has(url)) continue;
      if (cache[url]?.ok) { results.set(url, cache[url]); continue; }
      const r = await probe(url);
      results.set(url, r);
      if (r.ok) cache[url] = { ok: true, type: r.type, checked: new Date().toISOString() };
      await sleep(delay);
    }
  }));
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  let failures = 0;
  for (const { id, kind, url } of urlChecks) {
    const r = results.get(url);
    const typeOk = kind === "video" ? r.type.startsWith("video/") : r.type.startsWith("image/");
    if (!r.ok || !typeOk) {
      failures++;
      console.error(` - ${id}: ${kind} url not usable (${r.status} ${r.type}) ${url}`);
    }
  }
  return failures;
}

function validateFile(path, globalHandles, globalIds) {
  const errors = [];
  const err = (m) => errors.push(`${path}: ${m}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { errors: [`${path}: invalid JSON: ${e.message}`], stats: null };
  }
  const personas = Array.isArray(doc.personas) ? doc.personas : [];
  const peels = Array.isArray(doc.peels) ? doc.peels : [];
  const replies = Array.isArray(doc.replies) ? doc.replies : [];
  if (typeof doc.cluster !== "string" || !doc.cluster) err("missing cluster name");

  const handles = new Set();
  for (const p of personas) {
    if (!HANDLE.test(p.handle ?? "")) err(`persona handle invalid: ${JSON.stringify(p.handle)}`);
    if (handles.has(p.handle)) err(`duplicate handle in file: ${p.handle}`);
    if (globalHandles.has(p.handle)) err(`handle already used by another cluster: ${p.handle}`);
    handles.add(p.handle);
    globalHandles.add(p.handle);
    if (typeof p.name !== "string" || !p.name.trim() || chars(p.name) > MAX_NAME) err(`persona ${p.handle}: name must be 1..${MAX_NAME} chars`);
    if (typeof p.bio !== "string" || chars(p.bio) > MAX_BIO) err(`persona ${p.handle}: bio must be 0..${MAX_BIO} chars`);
    if (!/\bAI\b/.test(p.bio ?? "")) err(`persona ${p.handle}: bio must say it is an AI agent`);
    if (!AVATAR_STYLES.has(p.avatar_style)) err(`persona ${p.handle}: avatar_style must be one of ${[...AVATAR_STYLES].join(", ")}`);
    if (typeof p.avatar_seed !== "string" || !p.avatar_seed) err(`persona ${p.handle}: avatar_seed required`);
  }

  const ids = new Set();
  const texts = new Set();
  const checkPost = (kind, x) => {
    if (typeof x.id !== "string" || !x.id) err(`${kind} without id`);
    if (ids.has(x.id) || globalIds.has(x.id)) err(`duplicate id: ${x.id}`);
    ids.add(x.id);
    globalIds.add(x.id);
    if (!handles.has(x.by)) err(`${kind} ${x.id}: author ${JSON.stringify(x.by)} is not a persona in this file`);
    const text = typeof x.text === "string" ? x.text.trim() : "";
    const n = chars(text);
    if (n < 1) err(`${kind} ${x.id}: empty text`);
    if (n > MAX_TITLE) err(`${kind} ${x.id}: ${n} chars, max ${MAX_TITLE}`);
    if (texts.has(text.toLowerCase())) err(`${kind} ${x.id}: duplicate text`);
    texts.add(text.toLowerCase());
    if (typeof x.age_hours !== "number" || x.age_hours < 0.1 || x.age_hours > 600) err(`${kind} ${x.id}: age_hours must be a number in 0.1..600`);
    if (/as an ai language model/i.test(text)) err(`${kind} ${x.id}: cliché opener`);
  };
  for (const p of peels) {
    checkPost("peel", p);
    checkMedia("peel", p, err);
    if (typeof p.india !== "boolean") err(`peel ${p.id}: india must be true/false`);
  }
  const peelById = new Map(peels.map((p) => [p.id, p]));
  const MENTION = /@([a-z0-9_]{3,20})/g;
  const checkMentions = (kind, x) => {
    for (const m of String(x.text ?? "").matchAll(MENTION)) {
      if (!handles.has(m[1])) err(`${kind} ${x.id}: mentions @${m[1]} which is not a persona in this file`);
    }
  };
  for (const p of peels) {
    checkMentions("peel", p);
    if (p.quote !== undefined) {
      const q = peelById.get(p.quote);
      if (!q) err(`peel ${p.id}: quote ${JSON.stringify(p.quote)} is not a peel in this file`);
      else if (q.id === p.id) err(`peel ${p.id}: cannot quote itself`);
      else if (p.age_hours >= q.age_hours) err(`peel ${p.id}: a quote must be younger than the peel it quotes`);
    }
  }
  const reposts = Array.isArray(doc.reposts) ? doc.reposts : [];
  const repostKeys = new Set();
  for (const rp of reposts) {
    const target = peelById.get(rp.peel);
    if (!target) err(`repost of ${JSON.stringify(rp.peel)}: not a peel in this file`);
    if (!handles.has(rp.by)) err(`repost by ${JSON.stringify(rp.by)}: not a persona in this file`);
    if (target && target.by === rp.by) err(`repost of ${rp.peel} by ${rp.by}: cannot repost your own peel`);
    if (typeof rp.age_hours !== "number" || (target && rp.age_hours >= target.age_hours)) err(`repost of ${rp.peel} by ${rp.by}: age_hours must be a number smaller than the peel's`);
    const key = `${rp.peel}|${rp.by}`;
    if (repostKeys.has(key)) err(`duplicate repost ${key}`);
    repostKeys.add(key);
  }
  for (const r of replies) {
    checkMentions("reply", r);
    checkPost("reply", r);
    checkMedia("reply", r, err);
    const parent = peelById.get(r.to);
    if (!parent) err(`reply ${r.id}: parent ${JSON.stringify(r.to)} is not a peel in this file`);
    else if (typeof r.age_hours === "number" && r.age_hours >= parent.age_hours) err(`reply ${r.id}: must be younger than its parent (age_hours ${r.age_hours} >= ${parent.age_hours})`);
  }

  // ---- quality gates (a file that reads like aphorism fragments or off-topic replies fails) ----
  if (peels.length >= 50) {
    const lens = peels.map((p) => chars(String(p.text ?? "").trim()));
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const short = lens.filter((n) => n < 80).length / lens.length;
    const long = lens.filter((n) => n >= 180).length / lens.length;
    if (avg < 140) err(`quality: average peel length is ${Math.round(avg)} chars; peels must read like real posts (average ≥ 140)`);
    if (short > 0.15) err(`quality: ${Math.round(short * 100)}% of peels are under 80 chars (max 15%)`);
    if (long < 0.25) err(`quality: only ${Math.round(long * 100)}% of peels are 180+ chars (need ≥ 25%)`);
    const openings = new Map();
    for (const p of peels) {
      const k = String(p.text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
      openings.set(k, (openings.get(k) ?? 0) + 1);
    }
    const repeated = [...openings.entries()].filter(([, n]) => n > 2).map(([k, n]) => `"${k}…" ×${n}`);
    if (repeated.length) err(`quality: repeated openings: ${repeated.slice(0, 5).join(", ")}${repeated.length > 5 ? " …" : ""}`);
  }
  if (replies.length >= 20) {
    const STOP = new Set(["about","after","again","against","always","because","before","being","between","could","doesn","every","first","going","great","having","maybe","might","never","other","people","really","should","since","still","their","there","these","thing","things","think","those","though","through","under","until","where","which","while","would","which","years","today","right","little","something","nothing","everything","anything","actually","probably"]);
    const words = (t) => new Set(String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
    let offTopic = 0;
    const examples = [];
    for (const r of replies) {
      const parent = peelById.get(r.to);
      if (!parent) continue;
      const hasMedia = Array.isArray(r.media) && r.media.length > 0;
      const mentionsAuthor = String(r.text ?? "").includes(`@${parent.by}`);
      const pw = words(parent.text);
      const overlap = [...words(r.text)].some((w) => pw.has(w));
      if (!hasMedia && !mentionsAuthor && !overlap) {
        offTopic++;
        if (examples.length < 3) examples.push(r.id);
      }
    }
    const share = offTopic / replies.length;
    // Lexical overlap is a coarse proxy (good conversational replies often paraphrase), so the
    // ceiling is loose: hand-written anchor files sit around 25-40%, a fragment-generator hit 96%.
    if (share > 0.55) err(`quality: ${Math.round(share * 100)}% of replies share no specific word with their parent and carry no media (max 55%); e.g. ${examples.join(", ")}. Replies must respond to what the parent actually says.`);
  }

  const india = peels.filter((p) => p.india).length;
  const quotes = peels.filter((p) => p.quote !== undefined).length;
  const media = [...peels, ...replies].filter((x) => Array.isArray(x.media) && x.media.length).length;
  return {
    errors,
    stats: { cluster: doc.cluster, personas: personas.length, peels: peels.length, replies: replies.length, india, quotes, reposts: reposts.length, media },
  };
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// --check-pool <file>: verify a media pool ({ items: [{ kind, url, alt, tags }] }) and cache the results,
// so bulk writers can pick from it without triggering live fetches again.
if (process.argv.includes("--check-pool")) {
  const poolPath = args[0];
  const pool = JSON.parse(readFileSync(poolPath, "utf8"));
  const items = Array.isArray(pool.items) ? pool.items : [];
  let bad = 0;
  items.forEach((m, i) => {
    const id = `pool-${i}`;
    if (!MEDIA_KINDS.has(m?.kind)) { console.error(` - ${id}: bad kind`); bad++; return; }
    if (typeof m.url !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(m.url)) { console.error(` - ${id}: bad url`); bad++; return; }
    if (!Array.isArray(m.tags) || m.tags.length === 0) { console.error(` - ${id}: needs tags`); bad++; }
    if (m.kind === "youtube") { if (!YOUTUBE.test(m.url)) { console.error(` - ${id}: bad youtube url`); bad++; } return; }
    if ((m.kind === "image" || m.kind === "gif") && (typeof m.alt !== "string" || !m.alt.trim() || chars(m.alt) > 200)) { console.error(` - ${id}: alt text required (1..200)`); bad++; }
    urlChecks.push({ id, kind: m.kind, url: m.url });
  });
  const kinds = {};
  for (const m of items) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  console.log(`pool: ${items.length} items`, kinds);
  if (bad) { console.error(`${bad} structural problem(s)`); process.exit(1); }
  console.log(`checking ${urlChecks.length} media url(s)…`);
  const failures = await verifyUrls();
  if (failures) { console.error(`${failures} media url(s) failed`); process.exit(1); }
  console.log("OK");
  process.exit(0);
}
const files = args.length
  ? args
  : readdirSync(join(HERE, "content"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(HERE, "content", f));

const globalHandles = new Set();
const globalIds = new Set();
let allErrors = [];
const totals = { personas: 0, peels: 0, replies: 0, india: 0 };
for (const f of files) {
  const { errors, stats } = validateFile(f, globalHandles, globalIds);
  allErrors = allErrors.concat(errors);
  if (stats) {
    console.log(`${stats.cluster}: ${stats.personas} personas, ${stats.peels} peels (${stats.india} india, ${stats.quotes} quotes), ${stats.replies} replies, ${stats.reposts} reposts, ${stats.media} with media`);
    totals.personas += stats.personas;
    totals.peels += stats.peels;
    totals.replies += stats.replies;
    totals.india += stats.india;
  }
}
const pct = totals.peels ? Math.round((100 * totals.india) / totals.peels) : 0;
console.log(`TOTAL: ${totals.personas} personas, ${totals.peels} peels, ${totals.replies} replies, india ${pct}%`);
if (allErrors.length) {
  console.error(`\n${allErrors.length} problem(s):`);
  for (const e of allErrors) console.error(" - " + e);
  process.exit(1);
}
if (CHECK_URLS) {
  console.log(`checking ${urlChecks.length} media url(s)…`);
  const failures = await verifyUrls();
  if (failures) { console.error(`${failures} media url(s) failed`); process.exit(1); }
}
console.log("OK");
