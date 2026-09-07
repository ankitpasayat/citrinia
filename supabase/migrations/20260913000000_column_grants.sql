-- The column grants three migrations wrote never narrowed anything.
--
-- `grant update (name, bio, ...)` only restricts a role that does not already
-- hold UPDATE on the whole table -- and on a Supabase project every role does.
-- The platform ships
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so every table here was created with anon=arwdDxtm and authenticated=arwdDxtm.
-- A column grant on top of a table grant is a no-op: the table grant wins.
--
-- What that cost, before this file: any signed-in reader could PATCH their own
-- profile row straight through PostgREST and set `username` -- past
-- change_username(), so no username_history row was written (the old handle
-- stopped resolving instead of forwarding), no 30-day hold was honoured, and
-- the handle did not have to be lower case or even match what @mention parses.
-- `created_at`, the joined date, was writable the same way. On notifications,
-- every column was writable and rows could be forged or binned outright --
-- there RLS was the only thing still standing, since it grants no INSERT or
-- DELETE policy, but the comment above that grant says "no user may forge or
-- bin one" and the grant did not say it.
--
-- supabase/verify.sh could not catch any of this: it used to revoke the
-- platform's default privileges before applying migrations, making its
-- container the one environment where these column grants narrowed anything.
-- It keeps them now, so checks 6 and 12 mean what they say, and check 31 holds
-- the whole schema to the list below.
--
-- Revoke, then re-grant exactly what each policy assumes. This is the whole
-- intended surface for the two API roles; anything not named here is reachable
-- only through a security-definer function or the service role.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Reading: a signed-out visitor sees people and like counts, nothing else.
grant select on public.profiles to anon, authenticated;
grant select on public.likes to anon, authenticated;

grant select on public.peels to authenticated;
grant select on public.follows to authenticated;
grant select on public.reposts to authenticated;
grant select on public.bookmarks to authenticated;
grant select on public.peel_media to authenticated;
grant select on public.notifications to authenticated;
grant select on public.username_history to authenticated;

-- Writing: what a person does to their own rows.
grant insert, delete on public.peels to authenticated;
grant insert, delete on public.likes to authenticated;
grant insert, delete on public.follows to authenticated;
grant insert, delete on public.reposts to authenticated;
grant insert, delete on public.bookmarks to authenticated;
grant insert, delete on public.peel_media to authenticated;
grant usage on sequence public.likes_id_seq to authenticated;
grant usage on sequence public.peel_media_id_seq to authenticated;

-- profiles: everything the edit sheet and the browser-direct upload write.
-- Not username (change_username() owns it, and is security definer), not
-- created_at (the signup trigger owns it), not id.
grant update (name, bio, location, website, avatar_url, banner_url, pinned_peel_id)
  on public.profiles to authenticated;

-- notifications: marking one read, and nothing else.
grant update (read_at) on public.notifications to authenticated;
