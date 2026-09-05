// Peel reads. Every screen that shows peels goes through here so the shape the
// UI gets (author, like count, viewer-liked flag, reply count) is identical
// everywhere. Server-only: pass the request's Supabase client in.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PeelFilter = {
  /** null → top-level peels only; a string → replies of that peel; undefined → no parent filter. */
  parentId?: string | null;
  authorId?: string;
  authorIds?: string[];
  search?: string;
  limit?: number;
  /** Oldest first. Replies read as a thread; everything else is newest first. */
  ascending?: boolean;
};

const SELECT = "*, author:profiles(*), likes(user_id)";

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

/** Fetch peels with author, like count, viewer-liked flag and reply count. */
export async function fetchPeels(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  filter: PeelFilter = {},
): Promise<PeelUnionAuthor[]> {
  // `.in()` on an empty list matches nothing; skip the round trip.
  if (filter.authorIds && filter.authorIds.length === 0) return [];

  let query = supabase.from("peels").select(SELECT);
  if (filter.parentId === null) query = query.is("parent_id", null);
  else if (typeof filter.parentId === "string") query = query.eq("parent_id", filter.parentId);
  if (filter.authorId) query = query.eq("user_id", filter.authorId);
  if (filter.authorIds) query = query.in("user_id", filter.authorIds);
  // The term is literal text: escape the regex metacharacters so "2*3" does not match every peel.
  if (filter.search) query = query.filter("title", "imatch", escapeRegex(filter.search));

  const ordered = query.order("created_at", { ascending: filter.ascending ?? false });
  const { data, error } = await (filter.limit ? ordered.limit(filter.limit) : ordered);
  // A failed query is an error (it reaches app/error.tsx), never a fake empty feed.
  if (error) throw new Error(`Couldn't load peels: ${error.message}`);
  if (!data) return [];

  const replies = await replyCounts(supabase, data.map((row) => row.id));
  return data
    .map((row) => shape(row, viewerId, replies.get(row.id) ?? 0))
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
  return shape(data, viewerId, replies.get(data.id) ?? 0);
}

type Embedded = Database["public"]["Tables"]["peels"]["Row"] & {
  author: Profile | Profile[] | null;
  likes: { user_id: string }[] | null;
};

/** null when the author row did not come back, which would be a peel we cannot render. */
function shape(row: Embedded, viewerId: string, replies: number): PeelUnionAuthor | null {
  // PostgREST returns an embedded one-to-one as an object, but older shapes (and
  // some client versions) hand back a single-element array. Accept both.
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  if (!author) return null;
  const likes = row.likes ?? [];
  return {
    ...row,
    author,
    likes: likes.length,
    user_has_liked_peel: likes.some((like) => like.user_id === viewerId),
    replies,
  };
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
