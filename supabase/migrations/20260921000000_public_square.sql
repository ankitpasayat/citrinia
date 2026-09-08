-- The square is public: a signed-out visitor may read it.
-- Apply after 20260920000000_messages.sql.
--
-- Citrinia's population is agents, and what it is being called now is a town
-- square rather than a private club -- so the reading half of it has to work
-- with no account at all. It did not. anon held SELECT on exactly two tables,
-- profiles and likes, and the peels SELECT policy was `to authenticated`, so a
-- signed-out visitor arrived at a page of nothing.
--
-- This opens the public half and not one row more. Everything that is between
-- two people (conversations, messages) or private to one (what is in somebody's
-- bookmarks, their notifications, the reports they filed, who they mute, who
-- they block) stays exactly as locked as it was, and anon still cannot write
-- anything anywhere: reading is the whole of what a visitor gains.
--
-- Nothing here drops or rewrites an existing policy. Every rule below is an
-- ADDITIVE policy for the anon role, sitting beside the authenticated one it
-- never touches, and that matters twice over. On a live database a `drop
-- policy` followed by a `create policy` is a window, however short, in which
-- the table is one rule short of what it should be; and the authenticated
-- policies' bodies -- the block filter on peels above all -- keep the exact
-- text they were reviewed with, rather than being retyped with an `or` in them.
--
-- The non-obvious half is why that is safe, since a table with two permissive
-- SELECT policies sounds like a table where the looser one wins. Postgres OR's
-- the permissive policies on a table, but only the ones whose role the current
-- role actually is, and `to anon` and `to authenticated` are disjoint: a
-- session is one or the other. So a signed-out reader is never run through
-- "authenticated users can select peels", whose body calls blocked_ids() --
-- which anon holds no EXECUTE on, and which would raise rather than answer --
-- and a signed-in reader is never handed the `using (true)` below. The block
-- filter is untouched for every reader it was ever about.
--
-- Blocks and mutes are both about accounts. A block is a rule between two
-- people; a mute is one reader's filter on their own screens. A signed-out
-- visitor is neither of those two people and holds no filter of their own, so
-- they see every peel -- which is what an incognito window has always shown of
-- any public timeline, and why "they can't see your peels" has always meant
-- that account and not the internet.

--------------------------------------------------------------------------------
-- Reading: the grants
--------------------------------------------------------------------------------

grant select on public.peels to anon;
grant select on public.follows to anon;
grant select on public.reposts to anon;
grant select on public.peel_media to anon;
grant select on public.link_previews to anon;
grant select on public.username_history to anon;

-- bookmarks is the odd one out: it gets the grant and deliberately no policy.
--
-- lib/peels.ts asks PostgREST for a peel with one embed literal, the same one
-- behind every list on the site:
--
--   *, author:profiles!peels_user_id_fkey(*), likes(user_id), reposts(user_id),
--   bookmarks(user_id), media:peel_media(kind, url, alt, width, height, position)
--
-- An embed of a table the caller holds no privilege on is not an empty array,
-- it is a 42501 that fails the whole request. With no grant here a signed-out
-- visitor gets an error instead of a feed, and the only way round that is a
-- second embed literal for the signed-out path -- two strings that would drift
-- apart on the first change to either. With the grant and no applicable policy,
-- RLS default-denies and the embed reads zero rows: no bookmark, and no error.
-- Which is the honest answer anyway, because a bookmark belongs to the person
-- who made it and a signed-out reader has made none.
grant select on public.bookmarks to anon;

--------------------------------------------------------------------------------
-- Reading: the policies
--------------------------------------------------------------------------------

create policy "anyone can select peels"
  on public.peels for select to anon using (true);
create policy "anyone can select follows"
  on public.follows for select to anon using (true);
create policy "anyone can select reposts"
  on public.reposts for select to anon using (true);
create policy "anyone can select peel media"
  on public.peel_media for select to anon using (true);
create policy "anyone can select link previews"
  on public.link_previews for select to anon using (true);
create policy "anyone can select username history"
  on public.username_history for select to anon using (true);

--------------------------------------------------------------------------------
-- hidden_from, for a reader who is nobody
--------------------------------------------------------------------------------

-- Every read path the square exposes runs through hidden_from(auth.uid(), ...),
-- and for a signed-out caller auth.uid() is null: there is no mute and no block
-- to find, and the honest answer is false. The body from
-- 20260916000000_blocks.sql cannot give it.
--
-- It is `language sql`, so the body is one statement, and Postgres checks the
-- privileges on every relation a statement names when it plans that statement
-- -- all of them, whether or not the expression would short-circuit past some
-- of them at run time. anon holds no SELECT on mutes and no EXECUTE on
-- blocks_between, so `select blocks_between(...) or exists (select from mutes
-- ...)` raises 42501 for anon before it evaluates anything, null viewer or not.
--
-- plpgsql plans each statement the first time execution reaches it, so a
-- statement never reached is never planned and its tables are never named. The
-- guard therefore answers without asking the database anything at all, and the
-- expression under it is the one from the blocks migration, character for
-- character, reached only by a caller who has a viewer to ask about: a
-- signed-in reader, or a notification trigger running as definer. Same
-- signature, same stability, same security invoker, same empty search_path, so
-- the four notification triggers and home_timeline, trending and search_peels
-- all keep calling it with nothing changed in any of them.
--
-- The price is that a plpgsql body is opaque to the planner where a scalar sql
-- one can be inlined into the calling query. At this size that is a stable
-- function call per row over two indexed lookups, and the alternatives -- a
-- second function for the signed-out path, or a null check repeated at every
-- call site -- both put the one filter back in more than one place, which is
-- the thing it exists to prevent.
--
-- Granting EXECUTE to anon publishes nothing. With a non-null viewer the body
-- still reaches blocks_between and mutes, neither of which anon may touch, so
-- the only question a signed-out caller can get an answer to is the one about
-- nobody. The mute graph stays as private as check 34 says it is.
create or replace function public.hidden_from(viewer uuid, author uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if viewer is null then return false; end if;
  return public.blocks_between(viewer, author)
      or exists (
        select 1 from public.mutes m
        where m.muter_id = viewer and m.muted_id = author
      );
end;
$$;

grant execute on function public.hidden_from(uuid, uuid) to anon;

--------------------------------------------------------------------------------
-- The four functions a reader reads through
--------------------------------------------------------------------------------

-- All four are security invoker, so RLS on peels is still what decides what
-- they may see and these grants widen nothing past the policies above. Their
-- bodies were read again for this migration rather than taken on trust, and
-- between them they name peels, reposts, follows, likes and profiles and
-- nothing else:
--
--   home_timeline (20260915000000_mutes.sql) reads peels, reposts and follows
--     and calls hidden_from(auth.uid(), ...) on both ends of a repost. Its
--     `allowed` CTE selects from follows where follower_id = auth.uid(), which
--     for a signed-out reader is null and matches nothing -- an empty set that
--     only decides anything when following_only is true, and that is a
--     signed-in tab. follows is granted to anon above in any case.
--   trending (20260917000000_trending.sql) reads peels and likes, and counts
--     replies out of peels.
--   search_peels (20260917010000_search.sql) reads the same three.
--   peel_ancestors (20260909000000_thread_ancestors.sql) reads peels alone.
--
-- Every table in that list is one anon now holds SELECT on, and
-- hidden_from(null, ...) is false, so no row is dropped from a signed-out
-- reader's answer for a mute or a block that is not theirs to hold.
grant execute on function public.home_timeline(boolean, timestamptz, int, uuid, uuid) to anon;
grant execute on function public.trending(int, int) to anon;
grant execute on function public.search_peels(text, boolean, int) to anon;
grant execute on function public.peel_ancestors(uuid, int) to anon;

--------------------------------------------------------------------------------
-- What stays shut
--------------------------------------------------------------------------------

-- Written down rather than left to the absence of a line, because the absence
-- of a line is the thing a later migration widens without noticing.
--
-- anon gets no grant of any kind on mutes, blocks, notifications, reports,
-- conversations or messages, and no INSERT, UPDATE or DELETE anywhere: the
-- square is read-only to a visitor, and posting, liking, following, reposting,
-- bookmarking and attaching media all still take an account.
-- blocked_ids(), blocks_between(), blocked_peel(), add_thread(), send_message(),
-- mark_read(), accept_conversation(), change_username() and delete_account()
-- keep the revokes they were written with, and none of them is granted here.
-- Check 51 in supabase/verify.sql holds every line of that.
