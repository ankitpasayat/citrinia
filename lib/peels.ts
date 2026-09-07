// Peel reads. Every screen that shows peels goes through here so the shape the
// UI gets (author, counts, viewer flags, media, quote) is identical everywhere.
// Server-only: pass the request's Supabase client in.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PeelFilter = {
  /** null → top-level peels only; a string → replies of that peel; undefined → no parent filter. */
  parentId?: string | null;
  /** true → replies only (any parent). Ignored when `parentId` is set. */
  repliesOnly?: boolean;
  authorId?: string;
  authorIds?: string[];
  /** Exactly these peels, in whatever order the query returns them. */
  ids?: string[];
  /** Everything but this one. The Media tab's pinned peel is already above it. */
  excludeId?: string;
  /** Only peels carrying an attachment: the Media tab. */
  hasMedia?: boolean;
  search?: string;
  limit?: number;
  /** Keyset cursor from `encodeCursor`: only rows strictly after that one, newest first. */
  before?: string;
  /** Oldest first. Replies read as a thread; everything else is newest first. */
  ascending?: boolean;
};

// One string literal, not a concatenation: supabase-js parses this at the type
// level to work out the row shape, and only a literal reaches that parser.
// reposts and bookmarks add more peels↔profiles paths, so the author embed names its foreign key.
const SELECT =
  "*, author:profiles!peels_user_id_fkey(*), likes(user_id), reposts(user_id), bookmarks(user_id), media:peel_media(kind, url, alt, width, height, position)";

// The same shape with the media embed turned into a filter: `!inner` drops
// peels that carry no attachment. A second literal rather than a built string,
// for the same reason the first one is a literal -- supabase-js reads the row
// shape off the source text, and a concatenation reaches that parser as `string`.
const SELECT_WITH_MEDIA =
  "*, author:profiles!peels_user_id_fkey(*), likes(user_id), reposts(user_id), bookmarks(user_id), media:peel_media!inner(kind, url, alt, width, height, position)";

/** How many peels a timeline page asks for when nothing else is said. */
export const PAGE_SIZE = 20;

/**
 * A search term as a POSIX regex that matches itself, for PostgREST's `imatch`
 * (Postgres `~*`). Shared with the people search in app/search/page.tsx.
 *
 * `ilike` cannot carry a literal term: PostgREST rewrites every `*` in a
 * like/ilike operand to `%` with no escape, so `ilike.%*%` matches every row.
 * `imatch` is the same case-insensitive substring match with no such rewrite.
 */
export function escapeRegex(term: string): string {
  return term.replace(/[.^$|()[\]{}*+?\\]/g, (c) => `\\${c}`);
}

/** The timestamp shapes Postgres hands back, and takes back: `2026-09-05T22:37:34.359+00:00`. */
const TIMESTAMP =
  /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3])(:?[0-5]\d)?)?$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page cursor: the last row on the page, by every key the list is ordered on. */
type Cursor = { at: string; id: string; by: string | null };

/**
 * The cursor for the row that ends a page: its time, its id, and on the home
 * timeline who repeeled it (nothing for a peel's own row). `_` appears in
 * neither a timestamp nor a uuid, and survives a URL untouched.
 */
export function encodeCursor(at: string, id: string, by?: string | null): string {
  return `${at}_${id}${by ? `_${by}` : ""}`;
}

/**
 * A page cursor is something `encodeCursor` handed out, echoed back through the
 * URL. Postgres answers a malformed timestamp with an error rather than an empty
 * list, so anything that does not parse is dropped here and the reader gets the
 * first page instead of an error screen -- including a bare timestamp from
 * before ids were part of it.
 */
function cursor(before: string | undefined): Cursor | undefined {
  if (before === undefined) return undefined;
  const parts = before.split("_");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const [at, id, by] = parts;
  if (!TIMESTAMP.test(at) || !UUID.test(id) || (by !== undefined && !UUID.test(by))) return undefined;
  // The shape can be right while the calendar is not ("2026-02-31"), which
  // Postgres rejects just as loudly. Such a day rolls over in a Date, which shows.
  const [year, month, day] = at.split(/[-T ]/, 3).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined;
  return { at, id, by: by ?? null };
}

/**
 * PostgREST's spelling of `(column, idColumn) < (at, id)`: older, or the same
 * instant and a smaller id. Pairs with ordering on both columns, descending.
 * The timestamp is quoted so its `.`, `+` and `:` cannot be read as syntax.
 */
function olderThan(column: string, idColumn: string, c: Cursor): string {
  return `${column}.lt."${c.at}",and(${column}.eq."${c.at}",${idColumn}.lt.${c.id})`;
}

/** Fetch peels with author, counts, the viewer's like/repost/bookmark flags, media and quote. */
export async function fetchPeels(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  filter: PeelFilter = {},
): Promise<PeelUnionAuthor[]> {
  // `.in()` on an empty list matches nothing; skip the round trip.
  if (filter.authorIds && filter.authorIds.length === 0) return [];
  if (filter.ids && filter.ids.length === 0) return [];

  let query = supabase.from("peels").select(filter.hasMedia ? SELECT_WITH_MEDIA : SELECT);
  if (filter.parentId === null) query = query.is("parent_id", null);
  else if (typeof filter.parentId === "string") query = query.eq("parent_id", filter.parentId);
  else if (filter.repliesOnly) query = query.not("parent_id", "is", null);
  if (filter.authorId) query = query.eq("user_id", filter.authorId);
  if (filter.authorIds) query = query.in("user_id", filter.authorIds);
  if (filter.ids) query = query.in("id", filter.ids);
  if (filter.excludeId) query = query.neq("id", filter.excludeId);
  const before = cursor(filter.before);
  if (before) query = query.or(olderThan("created_at", "id", before));
  // The term is literal text: escape the regex metacharacters so "2*3" does not match every peel.
  if (filter.search) query = query.filter("title", "imatch", escapeRegex(filter.search));

  // The id breaks ties in the same direction, so a page boundary inside a tie
  // is a real place the next page can start from.
  const ascending = filter.ascending ?? false;
  const ordered = query.order("created_at", { ascending }).order("id", { ascending });
  const { data, error } = await (filter.limit ? ordered.limit(filter.limit) : ordered);
  // A failed query is an error (it reaches app/error.tsx), never a fake empty feed.
  if (error) throw new Error(`Couldn't load peels: ${error.message}`);
  if (!data) return [];

  const replies = await replyCounts(supabase, data.map((row) => row.id));
  const quotes = await fetchQuotes(supabase, viewerId, data);
  return data
    .map((row) => shape(row, viewerId, replies.get(row.id) ?? 0, quotes))
    .filter((peel) => peel !== null);
}

/** One peel by id with the same meta, or null when it is gone (or the id is not a peel id). */
export async function fetchPeel(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  id: string,
): Promise<PeelUnionAuthor | null> {
  const { data, error } = await supabase.from("peels").select(SELECT).eq("id", id).maybeSingle();
  // A malformed id is a 400 from PostgREST, which for a peel URL just means "not found".
  if (error && error.code !== "22P02") throw new Error(`Couldn't load the peel: ${error.message}`);
  if (!data) return null;
  const replies = await replyCounts(supabase, [data.id]);
  const quotes = await fetchQuotes(supabase, viewerId, [data]);
  return shape(data, viewerId, replies.get(data.id) ?? 0, quotes);
}

/**
 * What a peel answers, root first: the conversation above a reply, so opening
 * one shows what it is talking about. Empty for a peel that starts a thread.
 *
 * `peel_ancestors` walks parent_id in the database -- one round trip for the
 * chain rather than one per level -- and runs as the reader, so a peel they
 * cannot see ends the walk instead of leaking what it hangs off.
 *
 * ponytail: the SQL caps the walk at 25, keeping the nearest 25. A deeper
 * thread than that loses its oldest peels off the top with nothing said about
 * it; the cap is there to bound the work, and 25 cards is already a long page.
 */
export async function fetchAncestors(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  id: string,
): Promise<PeelUnionAuthor[]> {
  const { data, error } = await supabase.rpc("peel_ancestors", { of_peel: id });
  if (error) throw new Error(`Couldn't load the thread: ${error.message}`);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return [];

  const peels = await fetchPeels(supabase, viewerId, { ids });
  const byId = new Map(peels.map((peel) => [peel.id, peel]));
  // Keep the walk's order, not the peels' own, and skip any that went away
  // between the two reads: a gap in the chain beats an error page.
  return ids.map((ancestorId) => byId.get(ancestorId)).filter((peel) => peel !== undefined);
}

/**
 * The home feed: top-level peels and reposts merged on one clock, newest first.
 * `home_timeline` decides what is on the page and in what order; this hydrates
 * those ids and puts them back in the order the database gave them.
 *
 * A peel can appear twice, once as itself and once as somebody's repost -- those
 * are two events, and only the repost row carries `reposted_by`.
 *
 * `nextBefore` is the cursor for the next page (pass it back as `before`): the
 * last row's time, peel and repeeler, or null when this was the last one.
 */
export async function fetchTimeline(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  options: { followingOnly: boolean; before?: string; pageSize?: number },
): Promise<{ items: PeelUnionAuthor[]; nextBefore: string | null }> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const c = cursor(options.before);
  const { data, error } = await supabase.rpc("home_timeline", {
    following_only: options.followingOnly,
    before: c?.at ?? null,
    page_size: pageSize,
    before_id: c?.id ?? null,
    before_by: c?.by ?? null,
  });
  if (error) throw new Error(`Couldn't load the timeline: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { items: [], nextBefore: null };

  const peels = await fetchPeels(supabase, viewerId, { ids: [...new Set(rows.map((r) => r.peel_id))] });
  const byId = new Map(peels.map((peel) => [peel.id, peel]));
  const reposters = await fetchProfiles(
    supabase,
    rows.map((row) => row.repost_by).filter((id) => id !== null),
  );

  const items: PeelUnionAuthor[] = [];
  for (const row of rows) {
    const peel = byId.get(row.peel_id);
    // A peel composted between the RPC and the hydrate is simply not on the page.
    if (!peel) continue;
    items.push(row.repost_by ? { ...peel, reposted_by: reposters.get(row.repost_by) ?? null } : peel);
  }
  // A short page means there is nothing older to ask for.
  const last = rows[rows.length - 1];
  const nextBefore = rows.length < pageSize ? null : encodeCursor(last.sort_at, last.peel_id, last.repost_by);
  return { items, nextBefore };
}

/** The replies tab on a profile: this user's peels that hang off somebody's peel. */
export async function fetchRepliesBy(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  userId: string,
  before?: string,
): Promise<PeelUnionAuthor[]> {
  return fetchPeels(supabase, viewerId, {
    authorId: userId,
    repliesOnly: true,
    before,
    limit: PAGE_SIZE,
  });
}

/** The likes tab on a profile: peels this user liked, their most recent like first. */
export async function fetchLikedBy(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  userId: string,
  before?: string,
): Promise<PeelUnionAuthor[]> {
  return fetchByJoin(supabase, viewerId, "likes", userId, before);
}

/** The viewer's own bookmarks, newest first. RLS means only their own rows exist to read. */
export async function fetchBookmarks(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  before?: string,
): Promise<PeelUnionAuthor[]> {
  return fetchByJoin(supabase, viewerId, "bookmarks", viewerId, before);
}

/** The notification list: newest first, with the actor and the peel it points at. */
export async function fetchNotifications(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  limit: number = 50,
): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    // notifications has two foreign keys into profiles, so the actor embed names the one it means.
    .select("id, type, created_at, read_at, peel_id, actor:profiles!notifications_actor_id_fkey(*)")
    .eq("user_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Couldn't load notifications: ${error.message}`);
  if (!data) return [];

  const peelIds = [...new Set(data.map((row) => row.peel_id).filter((id) => id !== null))];
  const peels = await fetchPeels(supabase, viewerId, { ids: peelIds });
  const byId = new Map(peels.map((peel) => [peel.id, peel]));

  return data
    .map((row) => {
      const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
      // No actor row means a profile went away mid-read; there is nothing to render.
      if (!actor) return null;
      return {
        id: row.id,
        type: row.type as NotificationItem["type"],
        created_at: row.created_at,
        read_at: row.read_at,
        actor,
        peel: (row.peel_id && byId.get(row.peel_id)) || null,
      };
    })
    .filter((item) => item !== null);
}

/** How many notifications the viewer has not opened yet, for the bell. */
export async function countUnreadNotifications(
  supabase: SupabaseClient<Database>,
  viewerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", viewerId)
    .is("read_at", null);
  if (error) throw new Error(`Couldn't count notifications: ${error.message}`);
  return count ?? 0;
}

/** People to follow: profiles the viewer does not already follow, most-followed first. */
export async function fetchSuggestedProfiles(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  n: number = 3,
): Promise<Profile[]> {
  const { data: follows, error: followsError } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", viewerId);
  if (followsError) throw new Error(`Couldn't load suggestions: ${followsError.message}`);

  const skip = [viewerId, ...(follows ?? []).map((row) => row.followee_id)];
  // A pool rather than every profile: the ranking below is done in memory.
  const { data: pool, error: poolError } = await supabase
    .from("profiles")
    .select("*")
    .not("id", "in", `(${skip.join(",")})`)
    .limit(Math.max(n * 10, 50));
  if (poolError) throw new Error(`Couldn't load suggestions: ${poolError.message}`);
  if (!pool || pool.length === 0) return [];

  const { data: followers, error: countError } = await supabase
    .from("follows")
    .select("followee_id")
    .in("followee_id", pool.map((profile) => profile.id));
  if (countError) throw new Error(`Couldn't load suggestions: ${countError.message}`);

  const counts = new Map<string, number>();
  for (const row of followers ?? []) {
    counts.set(row.followee_id, (counts.get(row.followee_id) ?? 0) + 1);
  }
  return [...pool]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    .slice(0, n);
}

/** Which half of a follow a list shows: who follows this profile, or who it follows. */
/**
 * Who is at `/u/<handle>`: the profile, or the handle they moved to, or nothing.
 *
 * A handle somebody has let go of keeps pointing at them (username_history), so
 * every link ever written to an old handle still arrives -- until somebody else
 * takes that handle, at which point change_username() drops the forwarding row
 * and the handle belongs to whoever holds it now. Live profiles are checked
 * first for exactly that reason: the current owner always wins.
 */
export async function resolveHandle(
  supabase: SupabaseClient<Database>,
  handle: string,
): Promise<{ profile: Profile } | { movedTo: string } | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", handle)
    .maybeSingle();
  if (profile) return { profile };

  const { data: old } = await supabase
    .from("username_history")
    .select("profile:profiles!username_history_profile_id_fkey(username)")
    .eq("username", handle.toLowerCase())
    .maybeSingle();
  return old?.profile ? { movedTo: old.profile.username } : null;
}

export type FollowSide = "followers" | "following";

/** One row of a list of people: the profile, and where the viewer stands with it. */
export type Person = { profile: Profile; isFollowing: boolean; isSelf: boolean };

/**
 * One page of a profile's followers, or of the people it follows, newest follow
 * first. `follows` has no surrogate key -- the pair is the row -- so the page
 * boundary is (created_at, the other person's id), which is the same keyset
 * shape every other list here pages on.
 *
 * Two round trips rather than an embed: which foreign key to follow changes with
 * the side, and supabase-js only reads a `select()` written as one literal, so an
 * embed would mean two copies of the whole query to keep the row shape typed.
 */
export async function fetchFollowList(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  profileId: string,
  side: FollowSide,
  before?: string,
): Promise<{ people: Person[]; older: string | null }> {
  // The person each row is about, and the one whose list this is.
  const shown = side === "followers" ? "follower_id" : "followee_id";
  const owner = side === "followers" ? "followee_id" : "follower_id";

  let query = supabase.from("follows").select("*").eq(owner, profileId);
  const from = cursor(before);
  if (from) query = query.or(olderThan("created_at", shown, from));
  const { data: rows, error } = await query
    .order("created_at", { ascending: false })
    .order(shown, { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`Couldn't load ${side}: ${error.message}`);
  if (!rows || rows.length === 0) return { people: [], older: null };

  const ids = rows.map((row) => row[shown]);
  const [profiles, mine] = await Promise.all([
    supabase.from("profiles").select("*").in("id", ids),
    // Which of them the viewer already follows, so each row's button opens right.
    supabase.from("follows").select("followee_id").eq("follower_id", viewerId).in("followee_id", ids),
  ]);
  if (profiles.error) throw new Error(`Couldn't load ${side}: ${profiles.error.message}`);
  if (mine.error) throw new Error(`Couldn't load ${side}: ${mine.error.message}`);

  const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const followed = new Set((mine.data ?? []).map((row) => row.followee_id));

  // `.in()` answers in its own order, so the follow rows are what orders the page.
  const people = ids
    .map((id) => byId.get(id))
    .filter((profile) => profile !== undefined)
    .map((profile) => ({
      profile,
      isFollowing: followed.has(profile.id),
      isSelf: profile.id === viewerId,
    }));

  const last = rows[rows.length - 1];
  const older = rows.length === PAGE_SIZE ? encodeCursor(last.created_at, last[shown]) : null;
  return { people, older };
}

type EmbeddedMedia = {
  kind: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
  position: number;
};

type Embedded = Database["public"]["Tables"]["peels"]["Row"] & {
  author: Profile | Profile[] | null;
  likes: { user_id: string }[] | null;
  reposts?: { user_id: string }[] | null;
  bookmarks?: { user_id: string }[] | null;
  media?: EmbeddedMedia[] | null;
};

/** null when the author row did not come back, which would be a peel we cannot render. */
function shape(
  row: Embedded,
  viewerId: string,
  replies: number,
  quotes: Map<string, PeelUnionAuthor> = new Map(),
): PeelUnionAuthor | null {
  // PostgREST returns an embedded one-to-one as an object, but older shapes (and
  // some client versions) hand back a single-element array. Accept both.
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  if (!author) return null;
  const likes = row.likes ?? [];
  const reposts = row.reposts ?? [];
  // RLS on bookmarks is select-own, so this array is only ever the viewer's row.
  const bookmarks = row.bookmarks ?? [];
  return {
    ...row,
    author,
    likes: likes.length,
    user_has_liked_peel: likes.some((like) => like.user_id === viewerId),
    replies,
    reposts: reposts.length,
    user_has_reposted: reposts.some((repost) => repost.user_id === viewerId),
    user_has_bookmarked: bookmarks.length > 0,
    media: shapeMedia(row.media),
    quote: (row.quote_id && quotes.get(row.quote_id)) || null,
  };
}

/** Attachments in display order, without the ordering column the UI has no use for. */
function shapeMedia(media: EmbeddedMedia[] | null | undefined): PeelMedia[] {
  return [...(media ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(({ kind, url, alt, width, height }) => ({
      kind: kind as PeelMedia["kind"],
      url,
      alt,
      width,
      height,
    }));
}

/** Reply counts for a page of peels: one extra query, reduced to id → count.
 *  A self-referential embed on `peels` is ambiguous in PostgREST, hence the second read. */
async function replyCounts(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const { data } = await supabase.from("peels").select("parent_id").in("parent_id", ids);
  for (const row of data ?? []) {
    if (row.parent_id) counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The peels quoted by a page of peels, one level deep: a quoted peel's own quote
 * is left null, so a chain of quotes cannot walk the whole table.
 */
async function fetchQuotes(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  rows: { quote_id: string | null }[],
): Promise<Map<string, PeelUnionAuthor>> {
  const quotes = new Map<string, PeelUnionAuthor>();
  const ids = [...new Set(rows.map((row) => row.quote_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return quotes;

  const { data, error } = await supabase.from("peels").select(SELECT).in("id", ids);
  // A quote that will not load is a missing card, not a broken feed.
  if (error || !data) return quotes;
  const replies = await replyCounts(supabase, data.map((row) => row.id));
  for (const row of data) {
    const peel = shape(row, viewerId, replies.get(row.id) ?? 0);
    if (peel) quotes.set(peel.id, peel);
  }
  return quotes;
}

/**
 * Peels reached through a join table the viewer's row lives in (likes,
 * bookmarks), newest join first. `before` is a cursor over the join's own
 * created_at, which is what "most recently bookmarked" is ordered by.
 */
async function fetchByJoin(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  table: "likes" | "bookmarks",
  userId: string,
  before?: string,
): Promise<PeelUnionAuthor[]> {
  let query = supabase.from(table).select("peel_id, created_at").eq("user_id", userId);
  const at = cursor(before);
  if (at) query = query.or(olderThan("created_at", "peel_id", at));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("peel_id", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`Couldn't load peels: ${error.message}`);

  const ids = (data ?? []).map((row) => row.peel_id);
  const peels = await fetchPeels(supabase, viewerId, { ids });
  const byId = new Map(peels.map((peel) => [peel.id, peel]));
  // Keep the join's order, not the peels' own.
  return ids.map((id) => byId.get(id)).filter((peel) => peel !== undefined);
}

/** id → profile for a set of ids, for attaching reposters to timeline rows. */
async function fetchProfiles(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("*").in("id", unique);
  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}
