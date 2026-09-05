// Spec: fetchPeels/fetchPeel hand the UI a PeelUnionAuthor -- one author object,
// a like count, whether the viewer is in that like list, and how many peels hang
// off this one. Postgres is the boundary here, so it is faked: these tests are
// about the filters we send and the shape we return, not about PostgREST.
import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeRegex, fetchPeel, fetchPeels } from "./peels.ts";

type Filter = [op: string, column: string, value: unknown];
type Call = { table: string; columns: string; filters: Filter[] };

const ADA = { id: "u-ada", name: "Ada", username: "ada", avatar_url: "", bio: "" };
const BOB = { id: "u-bob", name: "Bob", username: "bob", avatar_url: "", bio: "" };

function peelRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    title: "hello",
    created_at: "2026-09-05T00:00:00Z",
    user_id: ADA.id,
    parent_id: null,
    author: ADA,
    likes: [],
    ...over,
  };
}

/** A stand-in for the PostgREST builder: records what we asked for, returns canned rows. */
function fake(rows: { peels?: unknown[]; replies?: { parent_id: string }[] }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call: Call = { table, columns, filters: [] };
          calls.push(call);
          // The reply-count query is the only one that selects parent_id alone.
          const data = columns === "parent_id" ? (rows.replies ?? []) : (rows.peels ?? []);
          const push = (op: string) => (column: string, value: unknown) => {
            call.filters.push([op, column, value]);
            return builder;
          };
          const builder = {
            is: push("is"),
            eq: push("eq"),
            in: push("in"),
            ilike: push("ilike"),
            filter: (column: string, op: string, value: unknown) => push(op)(column, value),
            order: push("order"),
            limit: (n: number) => push("limit")("", n),
            maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
            then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data, error: null }),
          };
          return builder;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

test("parentId null asks for top-level peels only", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id, { parentId: null });
  assert.deepEqual(calls[0].filters[0], ["is", "parent_id", null]);
});

test("a parentId string asks for that peel's replies, oldest first when ascending", async () => {
  const { client, calls } = fake({ peels: [peelRow({ id: "r1", parent_id: "p1" })] });
  await fetchPeels(client, ADA.id, { parentId: "p1", ascending: true });
  assert.deepEqual(calls[0].filters[0], ["eq", "parent_id", "p1"]);
  assert.deepEqual(calls[0].filters.at(-1), ["order", "created_at", { ascending: true }]);
});

test("no parent filter leaves parent_id alone", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id, { authorId: ADA.id });
  assert.equal(
    calls[0].filters.some(([, column]) => column === "parent_id"),
    false,
  );
});

test("peels default to newest first", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  await fetchPeels(client, ADA.id);
  assert.deepEqual(calls[0].filters.at(-1), ["order", "created_at", { ascending: false }]);
});

test("an empty authorIds list returns nothing without touching the database", async () => {
  const { client, calls } = fake({ peels: [peelRow()] });
  assert.deepEqual(await fetchPeels(client, ADA.id, { authorIds: [] }), []);
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
    peels: [peelRow({ id: "p1", likes: [{ user_id: ADA.id }] })],
    replies: [{ parent_id: "p1" }],
  });
  const peel = await fetchPeel(client, ADA.id, "p1");
  assert.deepEqual(calls[0].filters[0], ["eq", "id", "p1"]);
  assert.equal(peel?.likes, 1);
  assert.equal(peel?.user_has_liked_peel, true);
  assert.equal(peel?.replies, 1);
  assert.deepEqual(peel?.author, ADA);
});

test("fetchPeel returns null for an id that is not a peel", async () => {
  const { client } = fake({ peels: [] });
  assert.equal(await fetchPeel(client, ADA.id, "nope"), null);
});
