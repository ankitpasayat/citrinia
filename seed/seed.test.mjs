#!/usr/bin/env node
// Checks on the parts of seed.mjs that are easy to get quietly wrong: the plan
// has to be the same every run (or a re-run inserts duplicate-looking rows the
// database happily accepts), and peels have to be ordered so a parent always
// exists before the row pointing at it. Needs no database.
//
//   node seed/seed.test.mjs
import { buildPlan, dripOrder, loadContent, planDrip, uuidFor, DRIP_WINDOW_MS, LIKE_WINDOW_MS } from "./seed.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

const docs = loadContent([]);
const NOW = 1_757_100_000_000;
const plan = buildPlan(docs, NOW);

// --- ordering: what the foreign keys depend on -------------------------------
const seen = new Set();
let orderBreaks = 0;
for (const p of plan.peels) {
  if (p.parent_id && !seen.has(p.parent_id)) orderBreaks++;
  if (p.quote_id && !seen.has(p.quote_id)) orderBreaks++;
  seen.add(p.id);
}
check("every parent and quoted peel is inserted before the row pointing at it", orderBreaks === 0, `${orderBreaks} out of order`);

const ascending = plan.peels.every((p, i) => i === 0 || plan.peels[i - 1].created_at <= p.created_at);
check("peels are in ascending created_at order", ascending);

// --- determinism: same content, different clock, same graph ------------------
const key = (r) => `${r.user_id ?? r.follower_id}|${r.peel_id ?? r.followee_id}`;
const shape = (p) => ({
  peels: p.peels.map((x) => x.id).join(","),
  follows: p.follows.map(key).sort().join(","),
  likes: p.likes.map(key).sort().join(","),
  bookmarks: p.bookmarks.map(key).sort().join(","),
});
const a = shape(plan);
for (const delta of [1, 7_919, 3_600_000, 987_654_321]) {
  const b = shape(buildPlan(docs, NOW + delta));
  for (const part of ["peels", "follows", "likes", "bookmarks"]) {
    check(`${part} identical with the clock moved by ${delta}ms`, a[part] === b[part]);
  }
}

// --- one file changing must not reshuffle another cluster --------------------
// Writer agents keep editing their own content file. Adding a peel to one
// cluster is the harshest version of that: anything that indexes positionally
// into the whole corpus shifts, and every other cluster's generated rows move
// with it. Only the edited cluster is allowed to change.
const [first, ...rest] = docs;
const grown = [
  { ...first, peels: [...first.peels, { ...first.peels[0], id: `${first.cluster}-zzz`, text: "an added peel", age_hours: 250.25, quote: undefined }] },
  ...rest,
];
const b = shape(buildPlan(grown, NOW));
const otherClusters = new Set(rest.map((d) => d.cluster));
const onlyOthers = (plan, part) =>
  plan[part]
    .filter((r) => otherClusters.has(r._cluster))
    .map(key)
    .sort()
    .join(",");
const before = buildPlan(docs, NOW);
const after = buildPlan(grown, NOW);
for (const part of ["bookmarks", "likes"]) {
  check(`adding a peel to ${first.cluster} leaves the other clusters' ${part} untouched`, onlyOthers(before, part) === onlyOthers(after, part));
}
check("adding a peel to one cluster leaves follows untouched", a.follows === b.follows);

// --- ids ---------------------------------------------------------------------
check("uuidFor is stable", uuidFor("tech-001") === uuidFor("tech-001"));
check("uuidFor is distinct per content id", uuidFor("tech-001") !== uuidFor("tech-002"));
check("uuidFor looks like a v4 uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuidFor("tech-001")));
check("peel uuids are unique", new Set(plan.peels.map((p) => p.id)).size === plan.peels.length);
check("peel timestamps are unique (page cursors skip ties)", new Set(plan.peels.map((p) => p.created_at)).size === plan.peels.length);

// --- generated graph invariants ---------------------------------------------
check("nobody follows themselves", plan.follows.every((f) => f.follower_id !== f.followee_id));
check("no duplicate follow", new Set(plan.follows.map(key)).size === plan.follows.length);
const perFollower = new Map();
for (const f of plan.follows) perFollower.set(f.follower_id, (perFollower.get(f.follower_id) ?? 0) + 1);
const cap = Math.min(15, plan.personas.length - 1);
check(`every persona follows 5..${cap} others`, [...perFollower.values()].every((n) => n >= Math.min(5, cap) && n <= cap), JSON.stringify([...perFollower.values()].filter((n) => n < 5 || n > cap)));
check("every persona follows somebody", perFollower.size === plan.personas.length);

const byPeel = new Map(plan.peels.map((p) => [p.id, p]));
check("nobody likes their own peel", plan.likes.every((l) => byPeel.get(l.peel_id).user_id !== l.user_id));
check("no duplicate like", new Set(plan.likes.map(key)).size === plan.likes.length);
check("every like is after its peel", plan.likes.every((l) => l.created_at >= byPeel.get(l.peel_id).created_at));
check("every like is in the past", plan.likes.every((l) => Date.parse(l.created_at) <= NOW));
check("no duplicate bookmark", new Set(plan.bookmarks.map(key)).size === plan.bookmarks.length);
check("bookmarks are on top-level peels", plan.bookmarks.every((b) => byPeel.get(b.peel_id)._kind !== "reply"));
check("nobody reposts their own peel", plan.reposts.every((r) => byPeel.get(r.peel_id).user_id !== r.user_id));

// Likes should be a long tail, not a flat sprinkle: that is the whole point of
// the power law, and a broken exponent would show up as everything at 0 or 1.
const likesPer = new Map();
for (const l of plan.likes) likesPer.set(l.peel_id, (likesPer.get(l.peel_id) ?? 0) + 1);
const counts = plan.peels.map((p) => likesPer.get(p.id) ?? 0);
const most = Math.max(...counts);
const quiet = counts.filter((n) => n <= 3).length / counts.length;
check("most peels have 0-3 likes", quiet > 0.8, `${(quiet * 100).toFixed(0)}%`);
check("some peel has dozens of likes", most >= 20, `max ${most}`);

// --- media -------------------------------------------------------------------
check("media positions start at 0 and have no gaps", (() => {
  const byPeelMedia = new Map();
  for (const m of plan.media) {
    if (!byPeelMedia.has(m.peel_id)) byPeelMedia.set(m.peel_id, []);
    byPeelMedia.get(m.peel_id).push(m.position);
  }
  return [...byPeelMedia.values()].every((ps) => ps.sort((x, y) => x - y).every((p, i) => p === i));
})());
check("video and youtube media carry empty alt", plan.media.every((m) => (m.kind === "video" || m.kind === "youtube" ? m.alt === "" : m.alt.length > 0)));
check("every media url is https", plan.media.every((m) => m.url.startsWith("https://")));

// --- drip --------------------------------------------------------------------
// What the hourly workflow has to get right, checked against the intended
// behaviour rather than against what the code happens to produce: consecutive
// runs must carry on where the last one stopped (there is no state file, only
// the database), a reply must never go out before the peel it answers, and
// every timestamp must be inside the hour the run claims to be publishing.

const DRIP_NOW = 1_757_100_000_000;
const HOUR = 3_600_000;

/**
 * A database that starts empty and remembers what previous runs wrote — the
 * only thing planDrip is allowed to know. Deliberately not a mock of the HTTP
 * layer: this is the same data the real fetches hand over.
 */
function fakeDb() {
  return { peels: new Map(), handles: new Set(), follows: new Set(), reposts: new Set(), bookmarks: new Set() };
}
function applySlice(db, slice) {
  for (const h of slice.newHandles) db.handles.add(h);
  for (const p of slice.peels) db.peels.set(p.id, Date.parse(p.created_at));
  for (const r of slice.reposts) db.reposts.add(`${r.user_id}|${r.peel_id}`);
  for (const f of slice.follows) db.follows.add(`${f.follower_id}|${f.followee_id}`);
  for (const b of slice.bookmarks) db.bookmarks.add(`${b.user_id}|${b.peel_id}`);
  return slice;
}
const dripRun = (db, count, nowMs) =>
  applySlice(
    db,
    planDrip({
      plan,
      count,
      nowMs,
      existingPeels: db.peels,
      existingHandles: db.handles,
      existingFollows: db.follows,
      existingReposts: db.reposts,
      existingBookmarks: db.bookmarks,
    }),
  );

const db = fakeDb();
const runs = [];
for (let h = 0; h < 6; h++) runs.push(dripRun(db, 40, DRIP_NOW + h * HOUR));

const tops = (s) => s.peels.filter((p) => p._kind === "peel");
check("run 1 publishes exactly the requested number of top-level peels", tops(runs[0]).length === 40, `${tops(runs[0]).length}`);
check("run 1 publishes no replies or quotes: nothing to answer yet", runs[0].peels.length === 40, `${runs[0].peels.length} rows`);
check("run 1 asks for every one of its authors to be created", new Set(tops(runs[0]).map((p) => p.user_id)).size === runs[0].newHandles.length);
check("run 1 has no reactions: no personas and no peels existed", !runs[0].likes.length && !runs[0].follows.length && !runs[0].reposts.length && !runs[0].bookmarks.length);

check("run 2 publishes the next slice, none of run 1's", runs[1].peels.every((p) => !runs[0].peels.some((q) => q.id === p.id)));
check("run 2 answers run 1: replies and quotes appear", runs[1].peels.some((p) => p._kind !== "peel"), `${runs[1].peels.filter((p) => p._kind !== "peel").length}`);
check("later runs keep publishing", runs[5].peels.length > 0);

const everyRow = runs.flatMap((r) => r.peels);
check("no peel is published twice across six runs", new Set(everyRow.map((p) => p.id)).size === everyRow.length);
check("six runs of 40 publish 240 top-level peels", runs.reduce((n, r) => n + tops(r).length, 0) === 240);
check("remaining is the corpus minus everything published so far", runs.every((r, i) => r.remaining === plan.peels.length - runs.slice(0, i + 1).reduce((n, x) => n + x.peels.length, 0)));

// The invariant the whole scheme rests on.
let early = 0;
const publishedAt = new Map();
for (const r of runs) {
  for (const p of r.peels) {
    const target = p._kind === "reply" ? p.parent_id : p.quote_id;
    if (!target) continue;
    if (!publishedAt.has(target) || publishedAt.get(target) >= Date.parse(p.created_at)) early++;
  }
  for (const p of r.peels) publishedAt.set(p.id, Date.parse(p.created_at));
}
check("no reply or quote is ever published before the peel it points at", early === 0, `${early} too early`);

let knownBefore = new Set();
for (const [i, r] of runs.entries()) {
  const now = DRIP_NOW + i * HOUR;
  const known = knownBefore;
  knownBefore = new Set([...known, ...r.newHandles]);
  const stamps = r.peels.map((p) => Date.parse(p.created_at));
  const inWindow = stamps.every((ms) => ms > now - DRIP_WINDOW_MS && ms < now);
  check(`run ${i + 1}: every peel is dated inside the last 55 minutes`, inWindow);
  check(`run ${i + 1}: peel timestamps are unique`, new Set(stamps).size === stamps.length);
  check(`run ${i + 1}: peel timestamps only move forward`, stamps.every((ms, j) => j === 0 || ms > stamps[j - 1]));
  const edges = [...r.reposts, ...r.likes, ...r.follows, ...r.bookmarks].map((e) => Date.parse(e.created_at));
  check(`run ${i + 1}: every reaction is in the past`, edges.every((ms) => ms < now));
  const actors = [...r.reposts, ...r.likes, ...r.bookmarks].map((e) => e.user_id).concat(r.follows.flatMap((f) => [f.follower_id, f.followee_id]));
  check(`run ${i + 1}: every reaction is from a persona that already existed`, actors.every((h) => known.has(h)), actors.filter((h) => !known.has(h)).join(" "));
  const earlier = new Set(runs.slice(0, i).flatMap((p) => p.peels.map((q) => q.id)));
  check(`run ${i + 1}: every like is on a peel published in an earlier run`, r.likes.every((l) => earlier.has(l.peel_id)));
  check(`run ${i + 1}: at most a quarter as many reposts as peels`, r.reposts.length <= Math.ceil(40 / 4));
  check(`run ${i + 1}: at most half as many replies and quotes as peels`, r.peels.filter((p) => p._kind !== "peel").length <= Math.ceil(40 / 2));
}

check("a like never lands before its peel", runs.every((r) => r.likes.every((l) => Date.parse(l.created_at) > db.peels.get(l.peel_id) - 1)));

// Two runs inside one hour: every parent is seconds old, so every reply wants
// the same clamped instant. This is the case the unique-and-forward rule exists
// for, and the only one where a naive spread collides.
check("replies to peels published moments ago still get unique, ordered timestamps", (() => {
  const hot = fakeDb();
  for (const p of plan.personas) hot.handles.add(p.handle);
  for (const p of plan.peels) if (p._kind === "peel") hot.peels.set(p.id, DRIP_NOW - 30_000);
  const deps = dripRun(hot, 40, DRIP_NOW).peels;
  const ms = deps.map((p) => Date.parse(p.created_at));
  return deps.length > 1 && new Set(ms).size === ms.length && ms.every((v, i) => i === 0 || v > ms[i - 1]) && ms.every((v) => v < DRIP_NOW);
})());
check("likes stop once a peel is older than the like window", (() => {
  const old = fakeDb();
  old.handles.add(plan.personas[0].handle);
  const target = plan.likes.find((l) => l.user_id === plan.personas[0].handle);
  old.peels.set(target.peel_id, DRIP_NOW - LIKE_WINDOW_MS - HOUR);
  return !dripRun(old, 0, DRIP_NOW).likes.length;
})());

// --- drip: determinism and ordering ------------------------------------------
const fresh = fakeDb();
const again = [];
for (let h = 0; h < 3; h++) again.push(dripRun(fresh, 40, DRIP_NOW + 7_919 + h * HOUR));
check(
  "the same corpus drips in the same order however the clock is set",
  again.every((r, i) => r.peels.map((p) => p._contentId).join(",") === runs[i].peels.map((p) => p._contentId).join(",")),
);

const firstOrder = tops(runs[0]).map((p) => p._cluster);
const clustersInPlay = new Set(plan.peels.map((p) => p._cluster));
check("the first peel out is from the india anchor", firstOrder[0] === "india");
check(
  "clusters are interleaved, not drained one at a time",
  firstOrder.slice(0, clustersInPlay.size).length === new Set(firstOrder.slice(0, clustersInPlay.size)).size,
  firstOrder.slice(0, 6).join(" "),
);
check(
  "inside a cluster the file's own chronology is kept, oldest first",
  (() => {
    const seenAge = new Map();
    for (const p of runs.flatMap((r) => tops(r))) {
      const previous = seenAge.get(p._cluster);
      if (previous !== undefined && previous > p.created_at) return false;
      seenAge.set(p._cluster, p.created_at);
    }
    return true;
  })(),
);
check(
  "dripOrder does not depend on the order it is handed",
  (() => {
    const rows = plan.peels.filter((p) => p._kind === "peel").slice(0, 500);
    const a = dripOrder(rows).map((p) => p._contentId).join(",");
    const b = dripOrder([...rows].reverse()).map((p) => p._contentId).join(",");
    return a === b && dripOrder(rows).length === rows.length;
  })(),
);

check("a run against a fully imported corpus publishes nothing", (() => {
  const full = fakeDb();
  for (const p of plan.peels) full.peels.set(p.id, DRIP_NOW - 500 * HOUR);
  for (const p of plan.personas) full.handles.add(p.handle);
  const s = dripRun(full, 40, DRIP_NOW);
  return s.peels.length === 0 && s.remaining === 0 && s.likes.length === 0;
})());

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
