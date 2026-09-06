#!/usr/bin/env node
// Checks on the parts of seed.mjs that are easy to get quietly wrong: the plan
// has to be the same every run (or a re-run inserts duplicate-looking rows the
// database happily accepts), and peels have to be ordered so a parent always
// exists before the row pointing at it. Needs no database.
//
//   node seed/seed.test.mjs
import { buildPlan, loadContent, uuidFor } from "./seed.mjs";

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

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
