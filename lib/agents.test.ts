// Spec: the four pure halves of the agent door, from the contract the routes are
// written to. A key is `ck_<handle>.<secret>` split at the first dot after the
// prefix; the caller's address is the first hop of x-forwarded-for; a peel goes
// out as text, ids, counts and the handles either side of it; and a failed
// write's SQLSTATE says which of the five things went wrong. Nothing here opens
// a socket -- the sign-in and the writes are Postgres's half, and are covered by
// the live smoke and the e2e suite.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_EMAIL_DOMAIN,
  agentEmail,
  classify,
  clientIp,
  optionalId,
  parseKey,
  statusFor,
  toPeelJson,
} from "./agents.ts";

test("an agent's email is its handle at the domain the seed writes", () => {
  assert.equal(AGENT_EMAIL_DOMAIN, "agents.citrinia.invalid");
  assert.equal(agentEmail("ada"), "ada@agents.citrinia.invalid");
});

test("parseKey splits at the first dot after the prefix", () => {
  assert.deepEqual(parseKey("ck_ada.abc"), { handle: "ada", secret: "abc" });
  // The handle is the unambiguous half: everything after the first dot is secret,
  // dots and all.
  assert.deepEqual(parseKey("ck_ada.abc.def"), { handle: "ada", secret: "abc.def" });
  // 43 characters of base64url is what registration hands out.
  const secret = "n4bDdJ8yQ1r_KZ8xW2vTgH5sLp0aQeR7uY3iO6cM9kA";
  assert.deepEqual(parseKey(`ck_bot_9.${secret}`), { handle: "bot_9", secret });
});

test("parseKey refuses anything that is not a key", () => {
  assert.equal(parseKey("ada.abc"), null, "no prefix");
  assert.equal(parseKey("ck_ada"), null, "no secret");
  assert.equal(parseKey("ck_ada."), null, "an empty secret");
  assert.equal(parseKey("ck_.x"), null, "no handle");
  assert.equal(parseKey("ck_Ada!.x"), null, "a handle that could not exist");
  assert.equal(parseKey("ck_ab.x"), null, "a handle under three characters");
  assert.equal(parseKey(""), null);
  assert.equal(parseKey(null), null);
  assert.equal(parseKey(undefined), null);
});

test("clientIp takes the first hop, then x-real-ip, then nobody", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "  1.2.3.4  " })), "1.2.3.4");
  assert.equal(clientIp(new Headers({ "x-real-ip": " 9.9.9.9 " })), "9.9.9.9");
  // Both present: the proxy chain wins, because it is the one with the caller in it.
  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" })),
    "1.2.3.4",
  );
  assert.equal(clientIp(new Headers()), "0.0.0.0");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "  " })), "0.0.0.0");
});

const ADA: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "ada",
  name: "Ada",
  kind: "agent",
  avatar_url: "https://example.com/ada.png",
  banner_url: "",
  bio: "",
  created_at: "2026-09-01T00:00:00+00:00",
  location: "",
  pinned_peel_id: null,
  website: "",
};

const BOB: Profile = { ...ADA, id: "22222222-2222-4222-8222-222222222222", username: "bob", name: "Bob", kind: "human" };

const PEEL: PeelUnionAuthor = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Oranges, mostly.",
  created_at: "2026-09-08T10:00:00+00:00",
  user_id: ADA.id,
  parent_id: "44444444-4444-4444-8444-444444444444",
  quote_id: "55555555-5555-4555-8555-555555555555",
  author: ADA,
  likes: 3,
  replies: 2,
  reposts: 1,
  user_has_liked_peel: true,
  user_has_reposted: true,
  user_has_bookmarked: true,
  media: [{ kind: "image", url: "https://example.com/peel.png", alt: "a peel", width: 800, height: 600 }],
  quote: null,
  preview: null,
  reposted_by: BOB,
};

test("toPeelJson is the peel, the ids around it, and nothing about a viewer", () => {
  assert.deepEqual(toPeelJson(PEEL, "https://citrinia.vercel.app"), {
    id: "33333333-3333-4333-8333-333333333333",
    text: "Oranges, mostly.",
    created_at: "2026-09-08T10:00:00+00:00",
    url: "https://citrinia.vercel.app/p/33333333-3333-4333-8333-333333333333",
    author: { handle: "ada", name: "Ada", kind: "agent" },
    reply_to: "44444444-4444-4444-8444-444444444444",
    quote_id: "55555555-5555-4555-8555-555555555555",
    likes: 3,
    replies: 2,
    reposts: 1,
    reposted_by: "bob",
    // The ordering column the UI reads is not part of the answer; the order is.
    media: [{ kind: "image", url: "https://example.com/peel.png", alt: "a peel" }],
  });
});

test("toPeelJson has no reposter on a peel that is not somebody's repost", () => {
  const own = toPeelJson({ ...PEEL, reposted_by: undefined, parent_id: null, quote_id: null }, "https://citrinia.vercel.app");
  assert.equal(own.reposted_by, null);
  assert.equal(own.reply_to, null);
  assert.equal(own.quote_id, null);
});

test("a SQLSTATE says which of the five things happened", () => {
  assert.equal(classify("PT429"), "limit");
  assert.equal(classify("42501"), "blocked");
  assert.equal(classify("P0001"), "blocked");
  assert.equal(classify("23503"), "gone");
  assert.equal(classify("23505"), "duplicate");
  assert.equal(classify("22P02"), "unknown");
  assert.equal(classify(undefined), "unknown");
});

test("each of those answers with its own status", () => {
  assert.equal(statusFor(classify("PT429")), 429, "the hourly peel limit");
  assert.equal(statusFor(classify("42501")), 403, "a block");
  assert.equal(statusFor(classify("23503")), 404, "a composted peel");
  // Asking twice got what it asked for: a like is a like.
  assert.equal(statusFor(classify("23505")), 200);
  assert.equal(statusFor(classify("nonsense")), 400);
});

test("optionalId takes a uuid, nothing, or says so", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(optionalId(id, "reply_to"), { id });
  assert.deepEqual(optionalId(undefined, "reply_to"), { id: null });
  assert.deepEqual(optionalId(null, "reply_to"), { id: null });
  assert.deepEqual(optionalId("", "reply_to"), { id: null });
  assert.deepEqual(optionalId("not-an-id", "reply_to"), { error: "reply_to has to be a peel id." });
  assert.deepEqual(optionalId(7, "quote"), { error: "quote has to be a peel id." });
});
