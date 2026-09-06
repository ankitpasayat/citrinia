// Spec: fetchPeels/fetchPeel hand the UI a PeelUnionAuthor -- one author object,
// counts for likes, replies and reposts, whether the viewer is in each of those
// lists, the attachments in display order, and the peel this one quotes.
// Postgres is the boundary here, so it is faked: these tests are about the
// filters we send and the shape we return, not about PostgREST.
import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countUnreadNotifications,
  encodeCursor,
  escapeRegex,
  fetchBookmarks,
  fetchLikedBy,
  fetchNotifications,
  fetchPeel,
  fetchPeels,
  fetchRepliesBy,
  fetchSuggestedProfiles,
  fetchTimeline,
} from "./peels.ts";

type Filter = [op: string, column: string, value: unknown];
type Call = { table: string; columns: string; filters: Filter[] };
type Rpc = { name: string; args: Record<string, unknown> };

const ADA = { id: "u-ada", name: "Ada", username: "ada", avatar_url: "", bio: "" };
const BOB = { id: "u-bob", name: "Bob", username: "bob", avatar_url: "", bio: "" };
const CAT = { id: "u-cat", name: "Cat", username: "cat", avatar_url: "", bio: "" };
/** Real uuids, because a cursor's ids are checked before they reach a query. */
const ID = "11111111-1111-4111-8111-111111111111";
const BY = "22222222-2222-4222-8222-222222222222";
/** The row comparison `(created_at, idColumn) < (at, id)` as PostgREST spells it. */
const olderThan = (idColumn: string, at: string, id: string) =>
  `created_at.lt."${at}",and(created_at.eq."${at}",${idColumn}.lt.${id})`;

function peelRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    title: "hello",
    created_at: "2026-09-05T00:00:00Z",
    user_id: ADA.id,
    parent_id: null,
    quote_id: null,
    author: ADA,
    likes: [],
    reposts: [],
    bookmarks: [],
    media: [],
    ...over,
  };
}

/** A stand-in for the PostgREST builder: records what we asked for, returns canned rows. */
function fake(rows: {
  peels?: unknown[];
  replies?: { parent_id: string }[];
  /** The second and later full peel reads, i.e. the quoted peels. */
  quotes?: unknown[];
  timeline?: { peel_id: string; repost_by: string | null; sort_at: string }[];
  profiles?: unknown[];
  notifications?: unknown[];
  joins?: { peel_id: string; created_at: string }[];
  /** "who does the viewer follow" -- the first read of the follows table. */
  follows?: { followee_id: string }[];
  /** One row per follower of the pool profiles -- the second read of follows. */
  followers?: { followee_id: string }[];
  count?: number;
}) {
  const calls: Call[] = [];
  const rpcs: Rpc[] = [];
  let fullPeelReads = 0;
  let followReads = 0;

  function dataFor(table: string, columns: string): unknown[] {
    if (table === "peels" && columns === "parent_id") return rows.replies ?? [];
    if (table === "peels") {
      // The first full read is the page; anything after it is the quoted peels.
      fullPeelReads += 1;
      return (fullPeelReads === 1 ? rows.peels : rows.quotes) ?? [];
    }
    if (table === "profiles") return rows.profiles ?? [];
    if (table === "notifications") return rows.notifications ?? [];
    if (table === "follows") {
      followReads += 1;
      return (followReads === 1 ? rows.follows : rows.followers) ?? [];
    }
    if (table === "likes" || table === "bookmarks") return rows.joins ?? [];
    return [];
  }

  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: rows.timeline ?? [], error: null });
    },
    from(table: string) {
      return {
        select(columns: string) {
          const call: Call = { table, columns, filters: [] };
          calls.push(call);
          const data = dataFor(table, columns);
          const push = (op: string) => (column: string, value: unknown) => {
            call.filters.push([op, column, value]);
            return builder;
          };
          const builder = {
            is: push("is"),
            eq: push("eq"),
            in: push("in"),
            lt: push("lt"),
            or: (filters: string) => push("or")("", filters),
            ilike: push("ilike"),
            not: (column: string, op: string, value: unknown) => {
              call.filters.push([`not.${op}`, column, value]);
              return builder;
            },
            filter: (column: string, op: string, value: unknown) => push(op)(column, value),
            order: push("order"),
            limit: (n: number) => push("limit")("", n),
            maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
            then: (resolve: (r: { data: unknown[]; count: number; error: null }) => unknown) =>
              resolve({ data, count: rows.count ?? data.length, error: null }),
          };
          return builder;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls, rpcs };
}

// --- filters -----------------------------------------------------------------

test("the author embed names its foreign key, because peels and profiles are related three ways", async () => {
  // reposts and bookmarks are junction tables between peels and profiles, so a
  // bare `profiles(*)` is ambiguous: PostgREST answers 300 PGRST201 and every
  // screen that shows a peel breaks. Nothing else here can catch that, because
  // the fake below is not PostgREST.
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id);
  assert.match(calls[0].columns, /author:profiles!peels_user_id_fkey\(/);
});

test("parentId null asks for top-level peels only", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id, { parentId: null });
  assert.deepEqual(calls[0].filters[0], ["is", "parent_id", null]);
});

test("a parentId string asks for that peel's replies, oldest first when ascending", async () => {
  const { client, calls } = fake({ peels: [peelRow({ id: "r1", parent_id: "p1" })] });
  await fetchPeels(client, ADA.id, { parentId: "p1", ascending: true });
  assert.deepEqual(calls[0].filters[0], ["eq", "parent_id", "p1"]);
  assert.deepEqual(calls[0].filters.slice(-2), [
    ["order", "created_at", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("no parent filter leaves parent_id alone", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id, { authorId: ADA.id });
  assert.equal(
    calls[0].filters.some(([, column]) => column === "parent_id"),
    false,
  );
});

test("repliesOnly asks for peels that do have a parent", async () => {
  const { client, calls } = fake({ peels: [] });
  await fetchPeels(client, ADA.id, { repliesOnly: true });
  assert.deepEqual(calls[0].filters[0], ["not.is", "parent_id", null]);
});

test("a cursor names a row, and the next page starts strictly after it: older, or the same instant with a smaller id", async () => {
  // Two peels can share a created_at (one transaction's now(), or plain luck),
  // and a cursor on the time alone would skip whichever of them fell on the
  // far side of the page boundary.
  const { client, calls } = fake({ peels: [] });
  await fetchPeels(client, ADA.id, { before: encodeCursor("2026-09-05T00:00:00Z", ID) });
  assert.deepEqual(calls[0].filters[0], ["or", "", olderThan("id", "2026-09-05T00:00:00Z", ID)]);
});

test("garbage is page one, never an error", async () => {
  // Postgres answers a malformed timestamp or uuid with an error, not an empty
  // list, so a `before` that reaches the query is a 500 on somebody's address
  // bar. A bare timestamp is what the cursor used to be; those links are old.
  for (const junk of [
    "abc",
    "",
    "2026-09-05T00:00:00Z",
    "2026-02-31T00:00:00Z_" + ID,
    "2026-13-01T00:00:00Z_" + ID,
    "2026-09-05T00:00:00Z_nope",
    "_",
    `2026-09-05T00:00:00Z_${ID}_nope`,
    `2026-09-05T00:00:00Z_${ID}_${BY}_${BY}`,
    "now()_" + ID,
  ]) {
    const peels = fake({ peels: [] });
    await fetchPeels(peels.client, ADA.id, { before: junk });
    assert.equal(
      peels.calls[0].filters.some(([op]) => op === "or"),
      false,
      `${JSON.stringify(junk)} must not become a filter`,
    );
    const timeline = fake({ timeline: [] });
    await fetchTimeline(timeline.client, ADA.id, { followingOnly: false, before: junk });
    assert.deepEqual(
      [timeline.rpcs[0].args.before, timeline.rpcs[0].args.before_id, timeline.rpcs[0].args.before_by],
      [null, null, null],
      `${JSON.stringify(junk)} must not reach home_timeline`,
    );
    const joins = fake({ joins: [] });
    await fetchBookmarks(joins.client, ADA.id, junk);
    assert.equal(
      joins.calls[0].filters.some(([op]) => op === "or"),
      false,
      `${JSON.stringify(junk)} must not reach a join-table page`,
    );
  }
});

test("the cursor a list hands out is the cursor it takes back", async () => {
  // The shapes PostgREST returns for a timestamptz, plus the ISO the JS side builds.
  for (const good of [
    "2026-09-05T22:37:34.359+00:00",
    "2026-09-05T22:37:34.359123+00:00",
    "2026-09-05T22:37:34+05:30",
    "2026-09-05T22:37:34.359Z",
    "2026-09-05 22:37:34.359+00",
  ]) {
    const { client, calls } = fake({ peels: [] });
    await fetchPeels(client, ADA.id, { before: encodeCursor(good, ID) });
    assert.deepEqual(calls[0].filters[0], ["or", "", olderThan("id", good, ID)]);
  }
  // The timeline's cursor carries the repeeler as a third key, or nothing for a peel's own row.
  const three = fake({ timeline: [] });
  await fetchTimeline(three.client, ADA.id, { followingOnly: false, before: encodeCursor("2026-09-01T00:00:00Z", ID, BY) });
  assert.deepEqual(
    [three.rpcs[0].args.before, three.rpcs[0].args.before_id, three.rpcs[0].args.before_by],
    ["2026-09-01T00:00:00Z", ID, BY],
  );
  const two = fake({ timeline: [] });
  await fetchTimeline(two.client, ADA.id, { followingOnly: false, before: encodeCursor("2026-09-01T00:00:00Z", ID) });
  assert.deepEqual(
    [two.rpcs[0].args.before, two.rpcs[0].args.before_id, two.rpcs[0].args.before_by],
    ["2026-09-01T00:00:00Z", ID, null],
  );
});

test("peels default to newest first, ties broken by id the same way", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id);
  assert.deepEqual(calls[0].filters.slice(-2), [
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("an empty authorIds or ids list returns nothing without touching the database", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  assert.deepEqual(await fetchPeels(client, ADA.id, { authorIds: [] }), []);
  assert.deepEqual(await fetchPeels(client, ADA.id, { ids: [] }), []);
  assert.equal(calls.length, 0);
});

test("search matches the title anywhere in it", async () => {
  const { client, calls } = fake({ peels: [] });
  await fetchPeels(client, ADA.id, { search: "orange" });
  const [, column, value] = calls[0].filters[0];
  assert.equal(column, "title");
  // Unanchored, so it matches anywhere in the title, and the term is untouched
  // because it holds nothing a pattern could read as a wildcard.
  assert.equal(value, "orange");
});

test("a search term is literal text: no character in it acts as a wildcard", async () => {
  // Spec: the reader typed a phrase, not a pattern. "50%" finds peels that say
  // 50%, "2*3" finds peels that say 2*3 -- neither matches everything. ilike
  // cannot express this: PostgREST rewrites every "*" in a like/ilike operand to
  // "%" and offers no escape, so the filter has to be one that has no rewrite.
  const cases: [term: string, matches: string, misses: string][] = [
    ["50%", "half off, 50% today", "half off, 5 today"],
    ["a_b", "a_b", "axb"],
    ["2*3", "2*3 = 6", "2xxx3 = 6"],
    ["a.b", "a.b", "axb"],
    ["(a|b)", "(a|b)", "a"],
    ["^up$", "^up$", "up"],
    ["a+b?", "a+b?", "aab"],
    ["x[0]{2}", "x[0]{2}", "x00"],
    ["c:\\tmp", "c:\\tmp", "c:tmp"],
  ];

  for (const [term, matches, misses] of cases) {
    const { client, calls } = fake({ peels: [] });
    await fetchPeels(client, ADA.id, { search: term });
    const [op, column, value] = calls[0].filters[0];
    assert.equal(column, "title", `search for ${term}`);
    // The filter we send has to be a case-insensitive regex match, because that
    // is the only substring operator PostgREST passes through unrewritten.
    assert.equal(op, "imatch", `search for ${term}`);
    const sent = new RegExp(String(value), "i");
    assert.ok(sent.test(matches), `${term} must match ${JSON.stringify(matches)}`);
    assert.ok(!sent.test(misses), `${term} must not match ${JSON.stringify(misses)}`);
  }
});

test("escapeRegex leaves a term that has no metacharacters alone", () => {
  assert.equal(escapeRegex(""), "");
  assert.equal(escapeRegex("orange"), "orange");
  // LIKE's wildcards are ordinary characters to a regex; do not escape them.
  assert.equal(escapeRegex("50% off_now"), "50% off_now");
});

test("escapeRegex escapes every regex metacharacter, backslash first", () => {
  assert.equal(escapeRegex("\\"), "\\\\");
  assert.equal(escapeRegex(".^$|()[]{}*+?"), "\\.\\^\\$\\|\\(\\)\\[\\]\\{\\}\\*\\+\\?");
  // A backslash the reader typed stays a literal backslash, not an escape for
  // whatever follows it.
  assert.ok(new RegExp(escapeRegex("\\d")).test("\\d"));
  assert.ok(!new RegExp(escapeRegex("\\d")).test("7"));
});

// --- shape -------------------------------------------------------------------

test("an author embedded as a single-element array is unwrapped", async () => {
  const { client } = fake({ peels: [peelRow({ author: [BOB] })] });
  const [peel] = await fetchPeels(client, ADA.id);
  assert.deepEqual(peel.author, BOB);
});

test("likes become a count, and the viewer's own like is flagged", async () => {
  const { client } = fake({
    peels: [
      peelRow({ id: "p1", likes: [{ user_id: ADA.id }, { user_id: BOB.id }] }),
      peelRow({ id: "p2", likes: [{ user_id: BOB.id }] }),
      peelRow({ id: "p3", likes: [] }),
    ],
  });
  const peels = await fetchPeels(client, ADA.id);
  assert.deepEqual(
    peels.map((p) => [p.likes, p.user_has_liked_peel]),
    [
      [2, true],
      [1, false],
      [0, false],
    ],
  );
});

test("reposts become a count, and the viewer's own repost is flagged", async () => {
  const { client } = fake({
    peels: [
      peelRow({ id: "p1", reposts: [{ user_id: ADA.id }, { user_id: BOB.id }] }),
      peelRow({ id: "p2", reposts: [{ user_id: BOB.id }] }),
      peelRow({ id: "p3" }),
    ],
  });
  const peels = await fetchPeels(client, ADA.id);
  assert.deepEqual(
    peels.map((p) => [p.reposts, p.user_has_reposted]),
    [
      [2, true],
      [1, false],
      [0, false],
    ],
  );
});

test("a bookmark row means the viewer bookmarked it, because RLS returns nobody else's", () => {
  // Spec: the bookmarks select policy is "user_id = auth.uid()", so the embedded
  // array is the viewer's own row or nothing. Any row at all means "bookmarked".
  return (async () => {
    const { client } = fake({
      peels: [peelRow({ id: "p1", bookmarks: [{ user_id: ADA.id }] }), peelRow({ id: "p2" })],
    });
    const peels = await fetchPeels(client, ADA.id);
    assert.deepEqual(
      peels.map((p) => p.user_has_bookmarked),
      [true, false],
    );
  })();
});

test("media comes back in position order, with the ordering column dropped", async () => {
  const { client } = fake({
    peels: [
      peelRow({
        media: [
          { kind: "image", url: "https://x/2.png", alt: "two", width: 2, height: 2, position: 1 },
          { kind: "gif", url: "https://x/1.gif", alt: "one", width: null, height: null, position: 0 },
        ],
      }),
    ],
  });
  const [peel] = await fetchPeels(client, ADA.id);
  assert.deepEqual(peel.media, [
    { kind: "gif", url: "https://x/1.gif", alt: "one", width: null, height: null },
    { kind: "image", url: "https://x/2.png", alt: "two", width: 2, height: 2 },
  ]);
});

test("a peel with no media gets an empty list, never undefined", async () => {
  const { client } = fake({ peels: [peelRow({ media: null })] });
  const [peel] = await fetchPeels(client, ADA.id);
  assert.deepEqual(peel.media, []);
});

test("a quote_id is resolved to the quoted peel, one level deep", async () => {
  const { client, calls } = fake({
    peels: [peelRow({ id: "p1", quote_id: "q1" }), peelRow({ id: "p2" })],
    // The quoted peel itself quotes something; that inner quote is not followed.
    quotes: [peelRow({ id: "q1", title: "quoted", author: BOB, quote_id: "q2" })],
  });
  const [first, second] = await fetchPeels(client, ADA.id);
  assert.equal(first.quote?.id, "q1");
  assert.equal(first.quote?.title, "quoted");
  assert.deepEqual(first.quote?.author, BOB);
  assert.equal(first.quote?.quote, null, "a quote's own quote is not followed");
  assert.equal(second.quote, null);
  // Exactly one extra read for the distinct quote ids on the page.
  assert.deepEqual(
    calls.filter((c) => c.table === "peels" && c.columns !== "parent_id").length,
    2,
  );
});

test("a page with no quotes issues no quote query", async () => {
  const { client, calls } = fake({ peels: [peelRow(), peelRow({ id: "p2" })] });
  await fetchPeels(client, ADA.id);
  // The page read and the reply-count read, and nothing else.
  assert.equal(calls.length, 2);
});

test("reply counts land on the peel they belong to, and 0 where there are none", async () => {
  const { client, calls } = fake({
    peels: [peelRow({ id: "p1" }), peelRow({ id: "p2" }), peelRow({ id: "p3" })],
    replies: [{ parent_id: "p1" }, { parent_id: "p1" }, { parent_id: "p3" }],
  });
  const peels = await fetchPeels(client, ADA.id);
  assert.deepEqual(
    peels.map((p) => [p.id, p.replies]),
    [
      ["p1", 2],
      ["p2", 0],
      ["p3", 1],
    ],
  );
  // The counts come from one extra query over every id on the page, not one per peel.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].filters[0], ["in", "parent_id", ["p1", "p2", "p3"]]);
});

test("an empty page skips the reply-count query", async () => {
  const { client, calls } = fake({ peels: [] });
  assert.deepEqual(await fetchPeels(client, ADA.id), []);
  assert.equal(calls.length, 1);
});

test("fetchPeel returns the peel with the same meta", async () => {
  const { client, calls } = fake({
    peels: [peelRow({ id: "p1", likes: [{ user_id: ADA.id }], reposts: [{ user_id: BOB.id }] })],
    replies: [{ parent_id: "p1" }],
  });
  const peel = await fetchPeel(client, ADA.id, "p1");
  assert.deepEqual(calls[0].filters[0], ["eq", "id", "p1"]);
  assert.equal(peel?.likes, 1);
  assert.equal(peel?.user_has_liked_peel, true);
  assert.equal(peel?.reposts, 1);
  assert.equal(peel?.user_has_reposted, false);
  assert.equal(peel?.replies, 1);
  assert.deepEqual(peel?.author, ADA);
});

test("fetchPeel returns null for an id that is not a peel", async () => {
  const { client } = fake({ peels: [] });
  assert.equal(await fetchPeel(client, ADA.id, "nope"), null);
});

// --- timeline ----------------------------------------------------------------

test("fetchTimeline asks home_timeline for the page and hydrates its ids in order", async () => {
  const { client, rpcs, calls } = fake({
    timeline: [
      { peel_id: "p2", repost_by: null, sort_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", repost_by: null, sort_at: "2026-09-01T00:00:00Z" },
    ],
    // Deliberately the other way round: the RPC's order is the one that wins.
    peels: [peelRow({ id: "p1" }), peelRow({ id: "p2" })],
  });
  const { items } = await fetchTimeline(client, ADA.id, { followingOnly: false, pageSize: 20 });
  assert.deepEqual(rpcs, [
    {
      name: "home_timeline",
      args: { following_only: false, before: null, page_size: 20, before_id: null, before_by: null },
    },
  ]);
  assert.deepEqual(
    items.map((p) => p.id),
    ["p2", "p1"],
  );
  // The hydrate asks for the distinct ids on the page, in one read.
  assert.deepEqual(
    calls.find((c) => c.table === "peels" && c.columns !== "parent_id")?.filters[0],
    ["in", "id", ["p2", "p1"]],
  );
});

test("a repost row carries the reposter; the peel's own row does not", async () => {
  const { client } = fake({
    timeline: [
      { peel_id: "p1", repost_by: BOB.id, sort_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", repost_by: null, sort_at: "2026-09-01T00:00:00Z" },
    ],
    peels: [peelRow({ id: "p1" })],
    profiles: [BOB],
  });
  const { items } = await fetchTimeline(client, ADA.id, { followingOnly: false, pageSize: 20 });
  // The same peel twice: once as bob's repost, once as itself. Two events.
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].reposted_by, BOB);
  assert.equal(items[1].reposted_by, undefined);
});

test("fetchTimeline passes followingOnly and the before cursor straight through", async () => {
  const { client, rpcs } = fake({ timeline: [] });
  await fetchTimeline(client, ADA.id, {
    followingOnly: true,
    before: encodeCursor("2026-09-01T00:00:00Z", ID),
    pageSize: 5,
  });
  assert.deepEqual(rpcs[0].args, {
    following_only: true,
    before: "2026-09-01T00:00:00Z",
    page_size: 5,
    before_id: ID,
    before_by: null,
  });
});

test("nextBefore names the last row -- its time, its peel and who repeeled it -- on a full page, and is null on a short one", async () => {
  const full = fake({
    timeline: [
      { peel_id: "p2", repost_by: null, sort_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", repost_by: null, sort_at: "2026-09-01T00:00:00Z" },
    ],
    peels: [peelRow({ id: "p1" }), peelRow({ id: "p2" })],
  });
  assert.equal(
    (await fetchTimeline(full.client, ADA.id, { followingOnly: false, pageSize: 2 })).nextBefore,
    encodeCursor("2026-09-01T00:00:00Z", "p1"),
  );
  const repost = fake({
    timeline: [
      { peel_id: "p2", repost_by: null, sort_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", repost_by: BOB.id, sort_at: "2026-09-01T00:00:00Z" },
    ],
    peels: [peelRow({ id: "p1" }), peelRow({ id: "p2" })],
    profiles: [BOB],
  });
  assert.equal(
    (await fetchTimeline(repost.client, ADA.id, { followingOnly: false, pageSize: 2 })).nextBefore,
    encodeCursor("2026-09-01T00:00:00Z", "p1", BOB.id),
  );

  const short = fake({
    timeline: [{ peel_id: "p1", repost_by: null, sort_at: "2026-09-01T00:00:00Z" }],
    peels: [peelRow({ id: "p1" })],
  });
  assert.equal(
    (await fetchTimeline(short.client, ADA.id, { followingOnly: false, pageSize: 2 })).nextBefore,
    null,
  );
});

test("an empty timeline needs no hydrate", async () => {
  const { client, calls } = fake({ timeline: [] });
  assert.deepEqual(await fetchTimeline(client, ADA.id, { followingOnly: false }), {
    items: [],
    nextBefore: null,
  });
  assert.equal(calls.length, 0);
});

test("a peel composted between the RPC and the hydrate is dropped, not rendered blank", async () => {
  const { client } = fake({
    timeline: [
      { peel_id: "gone", repost_by: null, sort_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", repost_by: null, sort_at: "2026-09-01T00:00:00Z" },
    ],
    peels: [peelRow({ id: "p1" })],
  });
  const { items } = await fetchTimeline(client, ADA.id, { followingOnly: false, pageSize: 20 });
  assert.deepEqual(
    items.map((p) => p.id),
    ["p1"],
  );
});

// --- profile tabs ------------------------------------------------------------

test("fetchRepliesBy asks for that author's peels that have a parent", async () => {
  const { client, calls } = fake({ peels: [] });
  await fetchRepliesBy(client, ADA.id, BOB.id, encodeCursor("2026-09-01T00:00:00Z", ID));
  assert.deepEqual(calls[0].filters, [
    ["not.is", "parent_id", null],
    ["eq", "user_id", BOB.id],
    ["or", "", olderThan("id", "2026-09-01T00:00:00Z", ID)],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", "", 20],
  ]);
});

test("fetchLikedBy reads that user's likes newest first and keeps the like's order", async () => {
  const { client, calls } = fake({
    joins: [
      { peel_id: "p2", created_at: "2026-09-03T00:00:00Z" },
      { peel_id: "p1", created_at: "2026-09-01T00:00:00Z" },
    ],
    // The peel read comes back the other way round on purpose.
    peels: [peelRow({ id: "p1" }), peelRow({ id: "p2" })],
  });
  const peels = await fetchLikedBy(client, ADA.id, BOB.id);
  assert.equal(calls[0].table, "likes");
  assert.deepEqual(calls[0].filters[0], ["eq", "user_id", BOB.id]);
  assert.deepEqual(
    peels.map((p) => p.id),
    ["p2", "p1"],
  );
});

test("fetchBookmarks reads the viewer's own bookmarks, with the cursor on the bookmark time", async () => {
  const { client, calls } = fake({ joins: [] });
  await fetchBookmarks(client, ADA.id, encodeCursor("2026-09-01T00:00:00Z", ID));
  assert.equal(calls[0].table, "bookmarks");
  assert.deepEqual(calls[0].filters, [
    ["eq", "user_id", ADA.id],
    // The join's own keys: when it was saved, and which peel, so two saves in
    // one instant still page cleanly.
    ["or", "", olderThan("peel_id", "2026-09-01T00:00:00Z", ID)],
    ["order", "created_at", { ascending: false }],
    ["order", "peel_id", { ascending: false }],
    ["limit", "", 20],
  ]);
});

// --- notifications -----------------------------------------------------------

test("fetchNotifications reads the viewer's own, newest first, with actor and peel", async () => {
  const { client, calls } = fake({
    notifications: [
      {
        id: 2,
        type: "reply",
        created_at: "2026-09-03T00:00:00Z",
        read_at: null,
        peel_id: "p1",
        actor: BOB,
      },
      {
        id: 1,
        type: "follow",
        created_at: "2026-09-01T00:00:00Z",
        read_at: "2026-09-02T00:00:00Z",
        peel_id: null,
        actor: CAT,
      },
    ],
    peels: [peelRow({ id: "p1" })],
  });
  const items = await fetchNotifications(client, ADA.id, 30);
  assert.deepEqual(calls[0].filters, [
    ["eq", "user_id", ADA.id],
    ["order", "created_at", { ascending: false }],
    ["limit", "", 30],
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].actor, BOB);
  assert.equal(items[0].peel?.id, "p1");
  assert.equal(items[0].read_at, null);
  // A follow points at no peel.
  assert.deepEqual(items[1].actor, CAT);
  assert.equal(items[1].peel, null);
  assert.equal(items[1].read_at, "2026-09-02T00:00:00Z");
});

test("a notification whose peel is gone still renders, with no peel", async () => {
  const { client } = fake({
    notifications: [
      { id: 1, type: "like", created_at: "2026-09-01T00:00:00Z", read_at: null, peel_id: "gone", actor: BOB },
    ],
    peels: [],
  });
  const [item] = await fetchNotifications(client, ADA.id, 10);
  assert.equal(item.peel, null);
  assert.deepEqual(item.actor, BOB);
});

test("countUnreadNotifications counts the viewer's unopened ones without fetching them", async () => {
  const { client, calls } = fake({ count: 7 });
  assert.equal(await countUnreadNotifications(client, ADA.id), 7);
  assert.deepEqual(calls[0].filters, [
    ["eq", "user_id", ADA.id],
    ["is", "read_at", null],
  ]);
});

// --- suggestions -------------------------------------------------------------

const DEE = { ...CAT, id: "u-dee", username: "dee" };
const EVE = { ...CAT, id: "u-eve", username: "eve" };

test("fetchSuggestedProfiles asks for profiles that are neither the viewer nor already followed", async () => {
  const { client, calls } = fake({
    follows: [{ followee_id: BOB.id }],
    profiles: [CAT, DEE],
    followers: [],
  });
  await fetchSuggestedProfiles(client, ADA.id, 2);
  const pool = calls.find((c) => c.table === "profiles");
  assert.deepEqual(pool?.filters[0], ["not.in", "id", `(${ADA.id},${BOB.id})`]);
});

test("suggestions are ordered by how many followers each profile has, and capped at n", async () => {
  const { client } = fake({
    follows: [],
    profiles: [CAT, DEE, EVE],
    // Two people follow dee, one follows cat, nobody follows eve.
    followers: [{ followee_id: DEE.id }, { followee_id: DEE.id }, { followee_id: CAT.id }],
  });
  assert.deepEqual(
    (await fetchSuggestedProfiles(client, ADA.id, 3)).map((p) => p.id),
    [DEE.id, CAT.id, EVE.id],
  );

  const capped = fake({
    follows: [],
    profiles: [CAT, DEE, EVE],
    followers: [{ followee_id: DEE.id }, { followee_id: DEE.id }, { followee_id: CAT.id }],
  });
  assert.deepEqual(
    (await fetchSuggestedProfiles(capped.client, ADA.id, 2)).map((p) => p.id),
    [DEE.id, CAT.id],
  );
});

test("no profiles left to suggest is an empty list, not a crash", async () => {
  const { client } = fake({ follows: [], profiles: [] });
  assert.deepEqual(await fetchSuggestedProfiles(client, ADA.id, 3), []);
});
