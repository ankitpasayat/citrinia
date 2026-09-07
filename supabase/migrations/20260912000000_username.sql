-- Handles you can change, and old handles that still find you.
-- Apply after 20260911000000_pinned_peel.sql.

--------------------------------------------------------------------------------
-- Handles are lower case, and unique
--------------------------------------------------------------------------------

-- Two things were never true of `username` and had to become true before anyone
-- could choose one.
--
-- Unique: the column has carried no constraint at all since the first migration.
-- It got away with it because every handle came from a GitHub login, and GitHub
-- had already made them unique for us. The moment a handle is a person's to pick,
-- that stops being true.
--
-- Lower case: a mention resolves through `lower(username)` (the notify trigger)
-- and renders as a link to `/u/` plus the LOWER-CASED handle (lib/text.ts), while
-- the profile page looks the handle up exactly -- so a profile whose stored
-- handle carried a capital could never be reached from a mention of it. That is
-- a live bug, not a new risk, and one case for a handle is the fix: everything
-- that writes one from here on lower-cases it.
update public.profiles set username = lower(username) where username <> lower(username);

-- If this index cannot be built, two profiles differ only by case and one of
-- them has to be renamed by hand first. Better here, loudly, than at the first
-- rename attempt.
create unique index profiles_username_unique on public.profiles (lower(username));

--------------------------------------------------------------------------------
-- Where a handle has been
--------------------------------------------------------------------------------

-- One row per handle somebody has let go of, so `/u/<old handle>` can still
-- find them, and so nobody else can take it out from under them straight away.
-- Keyed by the handle rather than by a surrogate: a handle has one most-recent
-- owner, and a second release of the same handle overwrites the first.
create table public.username_history (
  username text primary key
    constraint username_history_shape check (username ~ '^[a-z0-9_]{3,20}$'),
  profile_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  released_at timestamptz not null default now()
);

-- "Which handles led here", for the redirect and for undoing a rename.
create index username_history_profile_idx on public.username_history (profile_id);

alter table public.username_history enable row level security;

-- Readable, because the redirect is a read: the page that cannot find a handle
-- asks this where it went. Not writable by anyone -- change_username() below is
-- the only thing that writes here, and it is security definer.
create policy "authenticated users can select username history"
  on public.username_history for select to authenticated using (true);

grant select on public.username_history to authenticated;

--------------------------------------------------------------------------------
-- Changing one
--------------------------------------------------------------------------------

-- The whole rename in one statement, and the only way to do it: `username` is
-- still not granted to anybody, so this function is the only writer and every
-- rule below is unavoidable rather than merely usual.
--
-- 3 to 20 of [a-z0-9_] is not a taste: it is exactly what `@handle` matches in
-- lib/text.ts. A handle outside it would be a handle nobody could mention.
--
-- The hold is 30 days, and it is one-sided: it stops SOMEBODY ELSE taking the
-- handle you just left, and never stops you taking your own back.
create function public.change_username(new_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold constant interval := interval '30 days';
  me uuid := auth.uid();
  handle text := lower(trim(coalesce(new_username, '')));
  was text;
  holder uuid;
  free_at timestamptz;
begin
  if me is null then
    raise exception 'sign in to change your handle' using errcode = 'insufficient_privilege';
  end if;
  if handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'a handle is 3 to 20 letters, numbers or underscores'
      using errcode = 'check_violation';
  end if;

  select p.username into was from public.profiles p where p.id = me;
  if was is null then
    raise exception 'no profile to rename' using errcode = 'no_data_found';
  end if;
  -- Asking for the handle you already have is not an error, and must not burn
  -- it into the history as though you had let it go.
  if was = handle then
    return was;
  end if;

  if exists (select 1 from public.profiles p where lower(p.username) = handle and p.id <> me) then
    raise exception 'that handle is taken' using errcode = 'unique_violation';
  end if;

  select h.profile_id, h.released_at + hold into holder, free_at
    from public.username_history h where h.username = handle;
  if holder is not null and holder <> me and free_at > now() then
    -- Days rather than a timestamp: this sentence is shown to whoever typed it.
    raise exception 'that handle is on hold for another % day(s)',
      greatest(1, ceil(extract(epoch from (free_at - now())) / 86400))::int
      using errcode = 'check_violation';
  end if;

  -- The handle being left goes on hold and starts pointing here, so anyone
  -- following an old link still arrives. `on conflict` because this handle may
  -- have been released before, by this profile or another one.
  insert into public.username_history (username, profile_id, released_at)
       values (was, me, now())
  on conflict (username) do update
       set profile_id = excluded.profile_id, released_at = excluded.released_at;

  -- Taking a handle means it is no longer an old handle of anybody's, including
  -- of yours: without this, /u/<new handle> would redirect to itself.
  delete from public.username_history h where h.username = handle;

  update public.profiles p set username = handle where p.id = me;
  return handle;
end;
$$;

revoke execute on function public.change_username(text) from public, anon;
grant execute on function public.change_username(text) to authenticated;

--------------------------------------------------------------------------------
-- Signup writes one of these too
--------------------------------------------------------------------------------

-- Same trigger as 20260910000000_profile.sql, with the handle lower-cased on the
-- way in so the column's one case rule holds for accounts as well as renames.
create or replace function public.insert_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  avatar text := coalesce(new.raw_user_meta_data->>'avatar_url', '');
begin
  if not public.storable_picture_url(avatar) then
    avatar := '';
  end if;

  insert into public.profiles (id, name, username, avatar_url)
  values (
    new.id,
    -- fix: GitHub users with no display name have a null "name", which aborted signup
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'user_name'),
    lower(new.raw_user_meta_data->>'user_name'),
    avatar
  );
  return new;
end;
$$;
