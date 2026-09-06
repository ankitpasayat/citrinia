-- Keyset tie-break. Every list pages on (created_at, id) instead of created_at
-- alone, so rows sharing a timestamp at a page boundary are neither skipped nor
-- repeated (lib/peels.ts). The home timeline needs a third key: a peel and a
-- repost of it are two rows that can share both a time and a peel id.

create index peels_timeline_idx on public.peels (created_at desc, id desc) where parent_id is null;
create index reposts_timeline_idx on public.reposts (created_at desc, peel_id desc, user_id desc);

-- The argument list changes, and `create or replace` would leave the old
-- overload -- and its execute grant -- behind.
drop function if exists public.home_timeline(boolean, timestamptz, int);

-- New arguments go last so positional callers keep working; the app calls it
-- with named arguments. A `before` with no `before_id` pages the old way,
-- strictly older, which is still correct, just tie-blind.
create function public.home_timeline(
  following_only boolean default false,
  before timestamptz default null,
  page_size int default 20,
  before_id uuid default null,
  before_by uuid default null
)
returns table (peel_id uuid, repost_by uuid, sort_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with allowed as (
    select f.followee_id as id from public.follows f where f.follower_id = auth.uid()
    union
    select auth.uid() as id
  ),
  events as (
    select p.id as peel_id, null::uuid as repost_by, p.created_at as sort_at
    from public.peels p
    where p.parent_id is null
      and (not coalesce(following_only, false) or p.user_id in (select a.id from allowed a))
    union all
    select r.peel_id, r.user_id, r.created_at
    from public.reposts r
    join public.peels p on p.id = r.peel_id and p.parent_id is null
    where (not coalesce(following_only, false) or r.user_id in (select a.id from allowed a))
  )
  select e.peel_id, e.repost_by, e.sort_at
  from events e
  -- Older; or the same instant and a smaller peel id; or the same peel at the
  -- same instant and a smaller reposter. A peel's own row counts as the nil
  -- uuid, so it sorts after every repost of it at that instant. A row compared
  -- against a null `before` is null, not true, hence the first arm.
  where before is null
     or (e.sort_at, e.peel_id, coalesce(e.repost_by, '00000000-0000-0000-0000-000000000000'::uuid))
      < (before, before_id, coalesce(before_by, '00000000-0000-0000-0000-000000000000'::uuid))
  order by e.sort_at desc, e.peel_id desc,
           coalesce(e.repost_by, '00000000-0000-0000-0000-000000000000'::uuid) desc
  -- A null page_size would make greatest() return 1, i.e. a one-row page; a
  -- caller who leaves it out means the default.
  limit least(greatest(coalesce(page_size, 20), 1), 100);
$$;

-- Supabase's default privileges hand EXECUTE on new functions to anon and
-- authenticated, so revoking from PUBLIC alone would not be enough.
revoke execute on function public.home_timeline(boolean, timestamptz, int, uuid, uuid) from public, anon, authenticated;
grant execute on function public.home_timeline(boolean, timestamptz, int, uuid, uuid) to authenticated;
