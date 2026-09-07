-- Mute: stop seeing somebody without telling them.
-- Apply after 20260914000000_settings.sql.
--
-- Mute is the quiet half of slice 7. It hides a person's peels from the reader's
-- feeds, from the replies under a peel and from search, and it stops their likes,
-- follows, replies, quotes and mentions from ringing the reader's bell. It does
-- NOT touch the muted person's profile -- going there and reading everything is
-- the whole difference between mute and block -- and it never tells them.
--
-- Block arrives in the next migration and extends hidden_from() below; the rule
-- for both lives in that one function.

--------------------------------------------------------------------------------
-- mutes
--------------------------------------------------------------------------------

-- The pair is the row, as in follows: there is nothing else to say about a mute
-- beyond who did it, to whom, and when. Primary key on (muter, muted) means a
-- second mute of the same person is a no-op rather than a duplicate, and its
-- index is exactly the lookup every reader below makes: "does A mute B".
create table public.mutes (
  muter_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  muted_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_not_self check (muter_id <> muted_id)
);

-- Born wide open: Supabase's default privileges grant anon and authenticated ALL
-- on every new table in public, so the grant below would be decoration and the
-- whole mute graph would be readable -- which is the one thing a mute must never
-- be. Revoke first, then say what is allowed. See 20260913000000_column_grants.sql.
revoke all on public.mutes from anon, authenticated;

alter table public.mutes enable row level security;

-- Select-own, with no exception for the muted party: "Do they know? No" is a row
-- they cannot read. There is deliberately no update policy -- a mute has nothing
-- to change, you either hold it or you drop it.
create policy "readers see only their own mutes"
  on public.mutes for select to authenticated using (muter_id = auth.uid());
create policy "authenticated users can mute"
  on public.mutes for insert to authenticated with check (muter_id = auth.uid());
create policy "authenticated users can unmute"
  on public.mutes for delete to authenticated using (muter_id = auth.uid());

grant select, insert, delete on public.mutes to authenticated;

--------------------------------------------------------------------------------
-- The one filter
--------------------------------------------------------------------------------

-- "May `viewer` see `author`'s rows?", answered in one place so the timeline, the
-- reply and search queries and the notification triggers cannot drift apart.
-- Block extends this function; nothing that calls it needs to know that happened.
--
-- SECURITY INVOKER, and that is the whole design of it:
--
--   * called from home_timeline (invoker, running as the reader), RLS on mutes
--     is select-own and `viewer` is auth.uid(), so it reads the reader's own
--     rows and answers truthfully;
--   * called from a notification trigger (security definer, so running as the
--     owner, which bypasses RLS), it answers truthfully for ANY viewer -- which
--     is what a trigger needs, since there the viewer is the recipient and the
--     caller is the actor;
--   * called directly by somebody fishing -- hidden_from('<alice>', '<bob>') --
--     RLS hides alice's rows from them and the answer is false. A mute stays
--     secret because the function cannot see what its caller cannot see.
--
-- A security definer version would have answered that last caller truthfully and
-- published the mute graph to anyone with a REST client.
create function public.hidden_from(viewer uuid, author uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.mutes m
    where m.muter_id = viewer and m.muted_id = author
  );
$$;

-- A new function is granted to PUBLIC by default, which here would mean a
-- signed-out caller can ask about somebody's mutes. Nothing would come back --
-- anon holds no grant on the table, so it would raise rather than answer -- but
-- "it errors instead" is not a rule, it is an accident of another grant. Say it.
-- Check 34 caught this one before it shipped.
revoke execute on function public.hidden_from(uuid, uuid) from public, anon;
grant execute on function public.hidden_from(uuid, uuid) to authenticated;

--------------------------------------------------------------------------------
-- The home timeline honours it
--------------------------------------------------------------------------------

-- Filtering muted authors after the fact, in the app, would hand back short
-- pages and a cursor that skips: the page size is decided here, so the filter
-- belongs here too.
--
-- A repost by a muted person is their action in the reader's feed, so it goes as
-- well -- otherwise muting somebody who repeels all day changes nothing.
-- Unchanged from 20260908010000_keyset.sql apart from the two hidden_from calls.
create or replace function public.home_timeline(
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
      and not public.hidden_from(auth.uid(), p.user_id)
    union all
    select r.peel_id, r.user_id, r.created_at
    from public.reposts r
    join public.peels p on p.id = r.peel_id and p.parent_id is null
    where (not coalesce(following_only, false) or r.user_id in (select a.id from allowed a))
      -- Both ends: whose peel it is, and who put it in front of the reader.
      and not public.hidden_from(auth.uid(), p.user_id)
      and not public.hidden_from(auth.uid(), r.user_id)
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

--------------------------------------------------------------------------------
-- The bell honours it
--------------------------------------------------------------------------------

-- Every notification is "actor did something to user", so every trigger asks the
-- same question before it writes: is the actor hidden from the recipient? The
-- triggers are security definer, so hidden_from() runs past RLS here and can
-- read a recipient's mutes even though the actor is the one holding the session.
--
-- The un-notify triggers are left alone on purpose: deleting a row that was
-- never inserted is already a no-op, and an unmute must not resurrect anything.

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare author uuid;
begin
  select p.user_id into author from public.peels p where p.id = new.peel_id;
  -- Liking your own peel notifies nobody.
  if author is null or author = new.user_id then return new; end if;
  if public.hidden_from(author, new.user_id) then return new; end if;
  insert into public.notifications (user_id, actor_id, type, peel_id)
  values (author, new.user_id, 'like', new.peel_id)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.notify_on_repost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare author uuid;
begin
  select p.user_id into author from public.peels p where p.id = new.peel_id;
  -- Reposting your own peel is allowed, it just does not notify you.
  if author is null or author = new.user_id then return new; end if;
  if public.hidden_from(author, new.user_id) then return new; end if;
  insert into public.notifications (user_id, actor_id, type, peel_id)
  values (author, new.user_id, 'repost', new.peel_id)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- follows_not_self already rejects following yourself.
  if public.hidden_from(new.followee_id, new.follower_id) then return new; end if;
  insert into public.notifications (user_id, actor_id, type, peel_id)
  values (new.followee_id, new.follower_id, 'follow', null)
  on conflict do nothing;
  return new;
end;
$$;

-- One trigger for the three things a new peel can announce: it replies to
-- someone, it quotes someone, and it mentions people by handle. The author never
-- gets notified, and nobody gets two notifications for the same peel -- being
-- the parent's author already told you about it, so a "@them" in the same peel
-- is not a second event.
--
-- A muted author is added to `notified` rather than skipped outright: being
-- muted must not turn a reply into a mention notification a moment later.
create or replace function public.notify_on_peel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  other uuid;
  handle text;
  notified uuid[] := array[]::uuid[];
begin
  if new.parent_id is not null then
    select p.user_id into other from public.peels p where p.id = new.parent_id;
    if other is not null and other <> new.user_id then
      if not public.hidden_from(other, new.user_id) then
        insert into public.notifications (user_id, actor_id, type, peel_id)
        values (other, new.user_id, 'reply', new.id) on conflict do nothing;
      end if;
      notified := notified || other;
    end if;
  end if;

  if new.quote_id is not null then
    select p.user_id into other from public.peels p where p.id = new.quote_id;
    if other is not null and other <> new.user_id and not (other = any (notified)) then
      if not public.hidden_from(other, new.user_id) then
        insert into public.notifications (user_id, actor_id, type, peel_id)
        values (other, new.user_id, 'quote', new.id) on conflict do nothing;
      end if;
      notified := notified || other;
    end if;
  end if;

  -- Handles are matched lower-case because GitHub logins are case-insensitive
  -- while raw_user_meta_data keeps whatever case the user typed.
  for handle in
    -- Same boundary rule as lib/text.ts: an @ glued to a preceding word character
    -- (an email address, say) is not a mention. Lower-cased so @Bob finds bob.
    select distinct m[1] from regexp_matches(lower(new.title), '(?:^|[^a-z0-9_])@([a-z0-9_]{3,20})', 'g') as m
  loop
    select pr.id into other from public.profiles pr where lower(pr.username) = handle limit 1;
    if other is not null and other <> new.user_id and not (other = any (notified)) then
      if not public.hidden_from(other, new.user_id) then
        insert into public.notifications (user_id, actor_id, type, peel_id)
        values (other, new.user_id, 'mention', new.id) on conflict do nothing;
      end if;
      notified := notified || other;
    end if;
  end loop;

  return new;
end;
$$;
