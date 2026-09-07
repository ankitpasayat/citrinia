-- Block: the loud half of slice 7.
-- Apply after 20260915000000_mutes.sql.
--
-- Where a mute is a filter the reader applies to their own screens, a block is a
-- rule about two people that both of them live under. So it is not a filter the
-- app remembers to apply: it goes in the SELECT policy on peels, and everything
-- that has ever read a peel -- the feed, the replies, search, the thread walk,
-- the quoted card, a profile, a page nobody has written yet -- obeys it without
-- being told. "They can't see your peels" is then true, rather than true of the
-- queries we happened to remember.
--
-- What a block does, from the artifact:
--   their peels          hidden both ways, and the profile says why
--   their replies        they cannot reply to you at all
--   notifications        not delivered (hidden_from already covers this)
--   following            both directions removed, and neither can follow again
--   do they know         yes, from the notice on the profile

--------------------------------------------------------------------------------
-- blocks
--------------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  blocked_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- The primary key indexes (blocker, blocked). Every rule below asks the question
-- both ways round -- "is there a block between these two, either direction" --
-- and the second half of that has no index without this one.
create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- Born wide open; see 20260913000000_column_grants.sql. Every new table.
revoke all on public.blocks from anon, authenticated;

alter table public.blocks enable row level security;

-- Readable by BOTH parties, which is the one place block differs from mute: the
-- blocked person is told, so their client has to be able to find out. It still
-- publishes nothing about anybody else -- a row is visible only to the two
-- people named in it.
create policy "both parties can see a block"
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());
create policy "authenticated users can block"
  on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy "authenticated users can unblock"
  on public.blocks for delete to authenticated using (blocker_id = auth.uid());

grant select, insert, delete on public.blocks to authenticated;

--------------------------------------------------------------------------------
-- The rule, and the one filter it feeds
--------------------------------------------------------------------------------

-- "Is there a block between these two, in either direction?" A block is
-- symmetric in what it hides even though only one person made it, so asking it
-- one way round is the commonest way to get this wrong.
--
-- SECURITY INVOKER, like hidden_from and for the same reason. Called from a
-- policy or from the timeline it runs as the reader, and the blocks policy above
-- shows a reader every row they are named in -- which is every row this question
-- can be about, since one of the two arguments is always auth.uid() there. From
-- a definer trigger it runs past RLS and answers for any pair. And to somebody
-- asking about two other people it answers false, having seen nothing.
create function public.blocks_between(a uuid, b uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a)
  );
$$;

revoke execute on function public.blocks_between(uuid, uuid) from public, anon;
grant execute on function public.blocks_between(uuid, uuid) to authenticated;

-- The same rule as a set: everybody a block separates the caller from, either
-- way round. blocks_between() answers about a pair, which is what a check on one
-- new row wants; this answers about the caller, which is what a policy applied
-- to a whole table wants -- it takes no arguments, so the planner runs it once
-- per query and hashes the result instead of calling a function per row. Same
-- rule, two shapes, and the pair form is not usable for the second job.
create function public.blocked_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select x.blocked_id from public.blocks x where x.blocker_id = auth.uid()
  union
  select x.blocker_id from public.blocks x where x.blocked_id = auth.uid();
$$;

revoke execute on function public.blocked_ids() from public, anon;
grant execute on function public.blocked_ids() to authenticated;

-- The one filter grows its second half. Everything that already called it -- the
-- home timeline, all four notification triggers -- starts honouring blocks here
-- without a line changing in any of them, which is what the function was for.
create or replace function public.hidden_from(viewer uuid, author uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.blocks_between(viewer, author)
      or exists (
        select 1 from public.mutes m
        where m.muter_id = viewer and m.muted_id = author
      );
$$;

--------------------------------------------------------------------------------
-- Peels: the block lives in the policy, not in the queries
--------------------------------------------------------------------------------

-- The original policy was `using (true)` -- every signed-in reader, every peel.
-- Replacing it is the whole enforcement story: no read path in the app names a
-- block, and none of them can forget to.
--
-- Mute is deliberately NOT here. A muted person's profile still reads in full,
-- so a mute cannot be a rule about what rows exist -- it is a filter on the
-- lists that a mute covers, and it lives in lib/peels.ts and home_timeline.
drop policy "authenticated users can select peels" on public.peels;
create policy "authenticated users can select peels"
  on public.peels for select to authenticated
  -- `not in` and not blocks_between(): both columns are NOT NULL so the null
  -- trap that usually makes `not in` wrong cannot happen here, and this form is
  -- evaluated once per query rather than once per peel.
  using (user_id not in (select public.blocked_ids()));

-- Attaching to somebody's peel: a reply, a quote, a like, a repost.
--
-- The SELECT policy hides a blocked person's peel, but an INSERT naming it by id
-- is not a select -- and a foreign key check runs past RLS, so the reference
-- lands whether or not the writer can see what they referenced. So each of those
-- four needs saying, and each needs a function that can see the peel in order to
-- answer: hence definer. It leaks nothing, because it only ever answers about
-- auth.uid(), who has already been told about the block by the profile notice.
create function public.blocked_peel(peel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.peels p
    where p.id = peel
      and exists (
        select 1 from public.blocks x
        where (x.blocker_id = p.user_id and x.blocked_id = auth.uid())
           or (x.blocker_id = auth.uid() and x.blocked_id = p.user_id)
      )
  );
$$;

revoke execute on function public.blocked_peel(uuid) from public, anon;
grant execute on function public.blocked_peel(uuid) to authenticated;

drop policy "authenticated users can insert their own peels" on public.peels;
create policy "authenticated users can insert their own peels"
  on public.peels for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.blocked_peel(parent_id)
    and not public.blocked_peel(quote_id)
  );

drop policy "authenticated user can like peels" on public.likes;
create policy "authenticated user can like peels"
  on public.likes for insert to authenticated
  with check (user_id = auth.uid() and not public.blocked_peel(peel_id));

drop policy "authenticated users can repost" on public.reposts;
create policy "authenticated users can repost"
  on public.reposts for insert to authenticated
  with check (user_id = auth.uid() and not public.blocked_peel(peel_id));

--------------------------------------------------------------------------------
-- Following: both directions removed, and neither can follow again
--------------------------------------------------------------------------------

drop policy "authenticated users can follow" on public.follows;
create policy "authenticated users can follow"
  on public.follows for insert to authenticated
  with check (
    follower_id = auth.uid()
    and not public.blocks_between(auth.uid(), followee_id)
  );

-- Severing what is already there. The blocker cannot delete the row where the
-- OTHER person follows them -- the unfollow policy is scoped to the follower --
-- so this is a definer trigger rather than a second statement in the action.
-- It also means the two directions cannot come apart: there is no window in
-- which one of them ran and the other did not.
create function public.unfollow_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.followee_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.followee_id = new.blocker_id);
  return new;
end;
$$;

create trigger unfollow_block after insert on public.blocks
  for each row execute function public.unfollow_on_block();

-- Unblocking does not put the follows back. Nobody's client asked for that, and
-- silently re-following somebody you had blocked is a worse surprise than
-- having to press the button again.

--------------------------------------------------------------------------------
-- Pins and bookmarks
--------------------------------------------------------------------------------

-- A pinned peel is read through the same SELECT policy, so a blocked reader sees
-- no pin: nothing to do. Bookmarks are the reader's own private list and hurt
-- nobody, so a block is not made to reach backwards into one -- the peel simply
-- stops loading, which the bookmarks page already handles for a composted peel.
