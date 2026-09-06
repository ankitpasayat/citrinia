\set ON_ERROR_STOP on
begin;

-- Fixed ids so assertions are exact.
\set ada '00000000-0000-0000-0000-000000000001'
\set bob '00000000-0000-0000-0000-000000000002'

-- 1. Signup trigger: GitHub user WITH a display name -> profile row with that name.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (:'ada', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ada@example.com',
        '{"provider":"github"}',
        '{"name":"Ada Lovelace","user_name":"ada","avatar_url":"https://avatars.githubusercontent.com/u/1"}',
        now(), now());
do $$
declare p public.profiles%rowtype;
begin
  select * into strict p from public.profiles where id = '00000000-0000-0000-0000-000000000001';
  if p.name <> 'Ada Lovelace' or p.username <> 'ada' or p.avatar_url <> 'https://avatars.githubusercontent.com/u/1' then
    raise exception 'check 1 FAILED: trigger wrote wrong profile: %', p;
  end if;
end $$;
\echo check 1 ok: signup with display name creates profile

-- 2. Signup trigger: GitHub user WITHOUT a display name -> name falls back to login (was a fatal signup bug).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (:'bob', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@example.com',
        '{"provider":"github"}',
        '{"user_name":"bob","avatar_url":"https://avatars.githubusercontent.com/u/2"}',
        now(), now());
do $$
declare p public.profiles%rowtype;
begin
  select * into strict p from public.profiles where id = '00000000-0000-0000-0000-000000000002';
  if p.name <> 'bob' or p.username <> 'bob' then
    raise exception 'check 2 FAILED: expected name fallback to login, got %', p;
  end if;
end $$;
\echo check 2 ok: signup without display name falls back to login

-- 3. Title length: empty rejected, 280 accepted, 281 rejected.
do $$ begin
  insert into public.peels (title, user_id) values ('', '00000000-0000-0000-0000-000000000001');
  raise exception 'check 3 FAILED: empty title accepted';
exception when check_violation then null; end $$;
insert into public.peels (title, user_id) values (repeat('x', 280), :'ada');
do $$ begin
  insert into public.peels (title, user_id) values (repeat('x', 281), '00000000-0000-0000-0000-000000000001');
  raise exception 'check 3 FAILED: 281-char title accepted';
exception when check_violation then null; end $$;
\echo check 3 ok: title length enforced (1..280)

-- 4. Duplicate like rejected.
insert into public.peels (id, title, user_id) values ('10000000-0000-0000-0000-000000000001', 'first peel', :'ada');
insert into public.likes (user_id, peel_id) values (:'bob', '10000000-0000-0000-0000-000000000001');
do $$ begin
  insert into public.likes (user_id, peel_id) values ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');
  raise exception 'check 4 FAILED: duplicate like accepted';
exception when unique_violation then null; end $$;
\echo check 4 ok: one like per user per peel

-- 5. Realtime publication includes peels.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peels') then
    raise exception 'check 5 FAILED: public.peels not in supabase_realtime';
  end if;
end $$;
\echo check 5 ok: peels in supabase_realtime publication

-- 6. RLS enabled on every table, 22 policies, API roles have the grants their policies assume.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public'
               and tablename in ('profiles','peels','likes','follows','reposts','bookmarks','peel_media','notifications')
               and not rowsecurity) then
    raise exception 'check 6 FAILED: RLS not enabled on every table';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 22 then
    raise exception 'check 6 FAILED: expected 22 policies, found %', (select count(*) from pg_policies where schemaname = 'public');
  end if;
  if not has_table_privilege('authenticated', 'public.peels', 'insert') or not has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'check 6 FAILED: API roles lack table grants';
  end if;
  if not has_table_privilege('authenticated', 'public.peels', 'delete')
     or not has_table_privilege('authenticated', 'public.follows', 'insert')
     or not has_column_privilege('authenticated', 'public.profiles', 'bio', 'update') then
    raise exception 'check 6 FAILED: authenticated lacks the core-feature grants';
  end if;
  if not has_table_privilege('authenticated', 'public.reposts', 'insert')
     or not has_table_privilege('authenticated', 'public.bookmarks', 'insert')
     or not has_table_privilege('authenticated', 'public.peel_media', 'insert')
     or not has_sequence_privilege('authenticated', 'public.peel_media_id_seq', 'usage')
     or not has_table_privilege('authenticated', 'public.notifications', 'select')
     or not has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update') then
    raise exception 'check 6 FAILED: authenticated lacks the social grants';
  end if;
  -- Notifications are written by triggers only: no user may forge or bin one.
  if has_table_privilege('authenticated', 'public.notifications', 'insert')
     or has_table_privilege('authenticated', 'public.notifications', 'delete')
     or has_column_privilege('authenticated', 'public.notifications', 'type', 'update') then
    raise exception 'check 6 FAILED: authenticated can write notifications';
  end if;
  -- The two RPCs are scoped by GRANT, not only by their bodies.
  if not has_function_privilege('authenticated', 'public.home_timeline(boolean, timestamptz, int)', 'execute')
     or has_function_privilege('anon', 'public.home_timeline(boolean, timestamptz, int)', 'execute') then
    raise exception 'check 6 FAILED: home_timeline execute grants are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.seed_triggers(boolean)', 'execute')
     or has_function_privilege('anon', 'public.seed_triggers(boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.seed_triggers(boolean)', 'execute') then
    raise exception 'check 6 FAILED: seed_triggers execute grants are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.ensure_media_bucket()', 'execute')
     or has_function_privilege('anon', 'public.ensure_media_bucket()', 'execute') then
    raise exception 'check 6 FAILED: ensure_media_bucket is not locked down';
  end if;
end $$;
\echo check 6 ok: RLS on, 22 policies, grants present

-- 7. RLS behaviour as an authenticated user: own peel ok, spoofed user_id blocked, own like ok, spoofed like blocked.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
insert into public.peels (title, user_id) values ('ada posts as ada', :'ada');
do $$ begin
  insert into public.peels (title, user_id) values ('ada posts as bob', '00000000-0000-0000-0000-000000000002');
  raise exception 'check 7 FAILED: RLS allowed inserting a peel as another user';
exception when insufficient_privilege then null; end $$;
insert into public.likes (user_id, peel_id) values (:'ada', '10000000-0000-0000-0000-000000000001');
do $$ begin
  delete from public.likes where user_id = '00000000-0000-0000-0000-000000000002';
  if found then raise exception 'check 7 FAILED: RLS allowed deleting another user''s like'; end if;
end $$;
do $$ begin
  if (select count(*) from public.peels) < 3 then raise exception 'check 7 FAILED: authenticated cannot read peels'; end if;
end $$;
reset role;
\echo check 7 ok: RLS scopes writes to auth.uid(), reads open to authenticated

-- 8. Anonymous role cannot read peels (policy is authenticated-only) but can read profiles.
set local role anon;
do $$ begin
  begin
    if (select count(*) from public.peels) <> 0 then raise exception 'check 8 FAILED: anon can read peels'; end if;
  exception when insufficient_privilege then null; -- no grant at all is also "cannot read"
  end;
  if (select count(*) from public.profiles) <> 2 then raise exception 'check 8 FAILED: anon cannot read profiles'; end if;
end $$;
reset role;
\echo check 8 ok: anon sees profiles but not peels

-- 9. Replies: parent_id must point at a real peel, and deleting a parent composts its replies.
insert into public.peels (id, title, user_id) values ('10000000-0000-0000-0000-000000000002', 'parent peel', :'ada');
insert into public.peels (id, title, user_id, parent_id)
  values ('10000000-0000-0000-0000-000000000003', 'a reply', :'bob', '10000000-0000-0000-0000-000000000002');
do $$ begin
  insert into public.peels (title, user_id, parent_id)
    values ('reply to nothing', '00000000-0000-0000-0000-000000000001', '1000000f-0000-0000-0000-00000000ffff');
  raise exception 'check 9 FAILED: parent_id accepted an id that is not a peel';
exception when foreign_key_violation then null; end $$;
do $$ begin
  if (select parent_id from public.peels where id = '10000000-0000-0000-0000-000000000003')
       is distinct from '10000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'check 9 FAILED: reply did not keep its parent_id';
  end if;
  delete from public.peels where id = '10000000-0000-0000-0000-000000000002';
  if exists (select 1 from public.peels where id = '10000000-0000-0000-0000-000000000003') then
    raise exception 'check 9 FAILED: deleting a parent left its reply behind';
  end if;
end $$;
\echo check 9 ok: replies reference a parent peel and cascade on delete

-- 10. Follows: no following yourself, no following twice.
insert into public.follows (follower_id, followee_id) values (:'ada', :'bob');
do $$ begin
  insert into public.follows (follower_id, followee_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
  raise exception 'check 10 FAILED: self-follow accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.follows (follower_id, followee_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
  raise exception 'check 10 FAILED: duplicate follow accepted';
exception when unique_violation then null; end $$;
\echo check 10 ok: follows reject self and duplicates

-- 11. Bio length: 160 accepted, 161 rejected.
update public.profiles set bio = repeat('x', 160) where id = :'ada';
do $$ begin
  update public.profiles set bio = repeat('x', 161) where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 11 FAILED: 161-char bio accepted';
exception when check_violation then null; end $$;
\echo check 11 ok: bio capped at 160 characters

-- 12. RLS as ada: she deletes her own peel and edits her own bio, and nobody else's.
insert into public.peels (id, title, user_id) values ('10000000-0000-0000-0000-000000000004', 'bob''s peel', :'bob');
insert into public.peels (id, title, user_id) values ('10000000-0000-0000-0000-000000000005', 'ada''s peel', :'ada');
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare n int;
begin
  delete from public.peels where id = '10000000-0000-0000-0000-000000000005';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 12 FAILED: ada could not delete her own peel (% rows)', n; end if;
  delete from public.peels where id = '10000000-0000-0000-0000-000000000004';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check 12 FAILED: RLS let ada delete bob''s peel (% rows)', n; end if;
  update public.profiles set name = 'Ada L.', bio = 'first programmer'
    where id = '00000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 12 FAILED: ada could not update her own profile (% rows)', n; end if;
  update public.profiles set bio = 'hacked' where id = '00000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check 12 FAILED: RLS let ada update bob''s bio (% rows)', n; end if;
end $$;
do $$ begin
  update public.profiles set username = 'notada' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 12 FAILED: authenticated can overwrite the GitHub-owned username';
exception when insufficient_privilege then null; end $$;
reset role;
\echo check 12 ok: delete and profile edit are scoped to auth.uid(), username stays GitHub-owned

-- 13. Anonymous role cannot read follows.
set local role anon;
do $$ begin
  begin
    if (select count(*) from public.follows) <> 0 then raise exception 'check 13 FAILED: anon can read follows'; end if;
  exception when insufficient_privilege then null; -- no grant at all is also "cannot read"
  end;
end $$;
reset role;
\echo check 13 ok: anon cannot read follows

--------------------------------------------------------------------------------
-- 20260907000000_social.sql
--------------------------------------------------------------------------------

-- A third user, so a mention can resolve to somebody who is neither the author
-- nor the person being replied to. Her GitHub login is mixed case on purpose:
-- handles in a peel are lower case, and the trigger has to bridge that.
\set cat '00000000-0000-0000-0000-000000000003'
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (:'cat', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat@example.com',
        '{"provider":"github"}',
        '{"name":"Cat Dev","user_name":"Cat_Dev","avatar_url":"https://avatars.githubusercontent.com/u/3"}',
        now(), now());

-- Checks 1-13 already liked and followed things, which the triggers below have
-- been quietly notifying about. Start the notification checks from empty so
-- every count here is exact.
delete from public.notifications;
insert into public.peels (id, title, user_id)
  values ('20000000-0000-0000-0000-000000000001', 'ada''s peel that gets reacted to', :'ada');

-- 14. Likes: another user's like notifies the author, your own notifies nobody,
--     and taking the like back takes the notification with it.
insert into public.likes (user_id, peel_id) values (:'ada', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 14 FAILED: liking your own peel notified you';
  end if;
end $$;
insert into public.likes (user_id, peel_id) values (:'bob', '20000000-0000-0000-0000-000000000001');
do $$
declare n public.notifications%rowtype;
begin
  select * into strict n from public.notifications;
  if n.user_id <> '00000000-0000-0000-0000-000000000001'
     or n.actor_id <> '00000000-0000-0000-0000-000000000002'
     or n.type <> 'like'
     or n.peel_id <> '20000000-0000-0000-0000-000000000001'
     or n.read_at is not null then
    raise exception 'check 14 FAILED: wrong like notification: %', n;
  end if;
end $$;
delete from public.likes where user_id = :'bob' and peel_id = '20000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 14 FAILED: unliking left the notification behind';
  end if;
end $$;
\echo check 14 ok: a like notifies the author, a self-like does not, an unlike undoes it

-- 15. Replies and quotes notify the peel they hang off, and the notification
--     points at the new peel (that is what the bell links to). Composting the
--     quoted peel leaves the quote standing.
delete from public.notifications;
insert into public.peels (id, title, user_id, parent_id)
  values ('20000000-0000-0000-0000-000000000002', 'bob replies', :'bob', '20000000-0000-0000-0000-000000000001');
insert into public.peels (id, title, user_id, quote_id)
  values ('20000000-0000-0000-0000-000000000003', 'bob quotes', :'bob', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if not exists (select 1 from public.notifications
                 where user_id = '00000000-0000-0000-0000-000000000001'
                   and actor_id = '00000000-0000-0000-0000-000000000002'
                   and type = 'reply' and peel_id = '20000000-0000-0000-0000-000000000002') then
    raise exception 'check 15 FAILED: no reply notification';
  end if;
  if not exists (select 1 from public.notifications
                 where user_id = '00000000-0000-0000-0000-000000000001'
                   and actor_id = '00000000-0000-0000-0000-000000000002'
                   and type = 'quote' and peel_id = '20000000-0000-0000-0000-000000000003') then
    raise exception 'check 15 FAILED: no quote notification';
  end if;
  if (select count(*) from public.notifications) <> 2 then
    raise exception 'check 15 FAILED: expected exactly 2 notifications, found %',
      (select count(*) from public.notifications);
  end if;
end $$;
-- A quote of a peel that is later composted stays a peel; a reply does not.
insert into public.peels (id, title, user_id) values ('20000000-0000-0000-0000-00000000000a', 'about to be composted', :'cat');
insert into public.peels (id, title, user_id, quote_id)
  values ('20000000-0000-0000-0000-00000000000b', 'quoting the doomed peel', :'ada', '20000000-0000-0000-0000-00000000000a');
delete from public.peels where id = '20000000-0000-0000-0000-00000000000a';
do $$
declare q public.peels%rowtype;
begin
  select * into q from public.peels where id = '20000000-0000-0000-0000-00000000000b';
  if q.id is null then raise exception 'check 15 FAILED: composting a quoted peel took the quote with it'; end if;
  if q.quote_id is not null then raise exception 'check 15 FAILED: quote_id did not fall back to null, it is %', q.quote_id; end if;
end $$;
\echo check 15 ok: replies and quotes notify, and a composted quote target leaves the quote standing

-- 16. Mentions: real handles only, case-insensitive against the GitHub login,
--     never yourself, and never twice for one peel.
delete from public.notifications;
insert into public.peels (id, title, user_id)
  values ('20000000-0000-0000-0000-000000000004',
          'hey @bob and @cat_dev, not @nobodyhere and not @ab', :'ada');
do $$ begin
  if (select count(*) from public.notifications where type = 'mention') <> 2 then
    raise exception 'check 16 FAILED: expected 2 mentions, found %',
      (select count(*) from public.notifications where type = 'mention');
  end if;
  if not exists (select 1 from public.notifications
                 where type = 'mention' and user_id = '00000000-0000-0000-0000-000000000002'
                   and actor_id = '00000000-0000-0000-0000-000000000001'
                   and peel_id = '20000000-0000-0000-0000-000000000004') then
    raise exception 'check 16 FAILED: @bob was not notified';
  end if;
  -- @cat_dev is the lower-cased form of the login "Cat_Dev".
  if not exists (select 1 from public.notifications
                 where type = 'mention' and user_id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'check 16 FAILED: @cat_dev did not resolve to the Cat_Dev profile';
  end if;
end $$;
delete from public.notifications;
insert into public.peels (id, title, user_id)
  values ('20000000-0000-0000-0000-000000000005', '@ada talking to herself', :'ada');
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 16 FAILED: mentioning yourself notified you';
  end if;
end $$;
-- An @ glued to a word (an email) is not a mention; an upper-case handle still is.
delete from public.notifications;
insert into public.peels (id, title, user_id)
  values ('20000000-0000-0000-0000-000000000007', 'mail me at ada@bobmail please, and hi @BOB', :'ada');
do $$ begin
  if (select count(*) from public.notifications where type = 'mention') <> 1
     or not exists (select 1 from public.notifications where type = 'mention' and user_id = '00000000-0000-0000-0000-000000000002') then
    raise exception 'check 16 FAILED: expected exactly one mention (@BOB), email-like text must not mention';
  end if;
end $$;
-- Replying to ada and saying "@ada" in the same breath is one event, not two.
delete from public.notifications;
insert into public.peels (id, title, user_id, parent_id)
  values ('20000000-0000-0000-0000-000000000006', 'thanks @ada', :'bob', '20000000-0000-0000-0000-000000000001');
do $$
declare n public.notifications%rowtype;
begin
  select * into strict n from public.notifications;
  if n.type <> 'reply' or n.user_id <> '00000000-0000-0000-0000-000000000001' then
    raise exception 'check 16 FAILED: expected one reply notification, got %', n;
  end if;
end $$;
\echo check 16 ok: mentions resolve real handles, skip the author, and never double up with a reply

-- 17. Follows notify with no peel attached, unfollowing removes it, and the
--     unique key treats those null peel_ids as equal so they cannot stack.
delete from public.notifications;
delete from public.follows;
insert into public.follows (follower_id, followee_id) values (:'ada', :'bob');
do $$
declare n public.notifications%rowtype;
begin
  select * into strict n from public.notifications;
  if n.user_id <> '00000000-0000-0000-0000-000000000002'
     or n.actor_id <> '00000000-0000-0000-0000-000000000001'
     or n.type <> 'follow' or n.peel_id is not null then
    raise exception 'check 17 FAILED: wrong follow notification: %', n;
  end if;
end $$;
do $$ begin
  insert into public.notifications (user_id, actor_id, type, peel_id)
    values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'follow', null);
  raise exception 'check 17 FAILED: a second follow notification stacked up';
exception when unique_violation then null; end $$;
delete from public.follows where follower_id = :'ada' and followee_id = :'bob';
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 17 FAILED: unfollowing left the notification behind';
  end if;
end $$;
\echo check 17 ok: follow notifies with a null peel, unfollow undoes it, duplicates collide

-- 18. Reposts: the table allows reposting your own peel (that is how you give it
--     another run at the timeline), it just never notifies you.
delete from public.notifications;
insert into public.reposts (user_id, peel_id) values (:'ada', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if not exists (select 1 from public.reposts
                 where user_id = '00000000-0000-0000-0000-000000000001'
                   and peel_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'check 18 FAILED: the table rejected a self-repost';
  end if;
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 18 FAILED: reposting your own peel notified you';
  end if;
end $$;
insert into public.reposts (user_id, peel_id) values (:'bob', '20000000-0000-0000-0000-000000000001');
do $$
declare n public.notifications%rowtype;
begin
  select * into strict n from public.notifications;
  if n.user_id <> '00000000-0000-0000-0000-000000000001'
     or n.actor_id <> '00000000-0000-0000-0000-000000000002'
     or n.type <> 'repost' or n.peel_id <> '20000000-0000-0000-0000-000000000001' then
    raise exception 'check 18 FAILED: wrong repost notification: %', n;
  end if;
end $$;
do $$ begin
  insert into public.reposts (user_id, peel_id)
    values ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');
  raise exception 'check 18 FAILED: duplicate repost accepted';
exception when unique_violation then null; end $$;
delete from public.reposts where user_id = :'bob' and peel_id = '20000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 18 FAILED: unreposting left the notification behind';
  end if;
end $$;
\echo check 18 ok: self-reposts are allowed but silent, a repost notifies, an unrepost undoes it

-- 19. Notifications are private, unforgeable, and the only column a user may
--     write is read_at.
delete from public.notifications;
insert into public.likes (user_id, peel_id) values (:'bob', '20000000-0000-0000-0000-000000000001'); -- notifies ada
insert into public.likes (user_id, peel_id) values (:'ada', '10000000-0000-0000-0000-000000000004'); -- notifies bob
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$
declare n int;
begin
  if (select count(*) from public.notifications) <> 1 then
    raise exception 'check 19 FAILED: bob sees % notifications, expected only his own',
      (select count(*) from public.notifications);
  end if;
  update public.notifications set read_at = now() where read_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 19 FAILED: bob could not mark his own notification read (% rows)', n; end if;
end $$;
do $$ begin
  insert into public.notifications (user_id, actor_id, type)
    values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'follow');
  raise exception 'check 19 FAILED: a user forged a notification';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.notifications;
  raise exception 'check 19 FAILED: a user deleted notifications';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.notifications set type = 'follow';
  raise exception 'check 19 FAILED: a user rewrote a notification''s type';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin
  if (select count(*) from public.notifications where read_at is not null) <> 1
     or (select count(*) from public.notifications) <> 2 then
    raise exception 'check 19 FAILED: exactly bob''s notification should be read';
  end if;
end $$;
\echo check 19 ok: notifications are per-user, unforgeable, and only read_at is writable

-- 20. Bookmarks are private: bob cannot see ada's, and cannot make one for her.
insert into public.bookmarks (user_id, peel_id) values (:'ada', '20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if (select count(*) from public.bookmarks) <> 0 then
    raise exception 'check 20 FAILED: bob can read ada''s bookmarks';
  end if;
end $$;
do $$ begin
  insert into public.bookmarks (user_id, peel_id)
    values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004');
  raise exception 'check 20 FAILED: bob bookmarked on ada''s behalf';
exception when insufficient_privilege then null; end $$;
insert into public.bookmarks (user_id, peel_id) values (:'bob', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from public.bookmarks) <> 1 then
    raise exception 'check 20 FAILED: bob cannot see his own bookmark';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.bookmarks) <> 2 then
    raise exception 'check 20 FAILED: expected 2 bookmark rows in total';
  end if;
end $$;
\echo check 20 ok: a bookmark is visible only to the person who made it

-- 21. peel_media: only the peel's author may attach or detach, the columns are
--     constrained, and composting the peel takes its media with it.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
insert into public.peel_media (peel_id, position, kind, url, alt, width, height)
  values ('20000000-0000-0000-0000-000000000001', 0, 'image', 'https://example.com/lemon.png', 'a lemon', 800, 600);
do $$ begin
  insert into public.peel_media (peel_id, position, kind, url, alt)
    values ('10000000-0000-0000-0000-000000000004', 0, 'image', 'https://example.com/x.png', 'x');
  raise exception 'check 21 FAILED: ada stapled media to bob''s peel';
exception when insufficient_privilege then null; end $$;
do $$ begin
  if (select count(*) from public.peel_media) <> 1 then
    raise exception 'check 21 FAILED: authenticated cannot read peel media';
  end if;
end $$;
reset role;
do $$ begin
  insert into public.peel_media (peel_id, position, kind, url)
    values ('20000000-0000-0000-0000-000000000001', 1, 'audio', 'https://example.com/a.mp3');
  raise exception 'check 21 FAILED: an unknown media kind was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.peel_media (peel_id, position, kind, url)
    values ('20000000-0000-0000-0000-000000000001', 1, 'image', 'http://example.com/a.png');
  raise exception 'check 21 FAILED: a non-https media url was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.peel_media (peel_id, position, kind, url, alt)
    values ('20000000-0000-0000-0000-000000000001', 1, 'image', 'https://example.com/a.png', repeat('x', 201));
  raise exception 'check 21 FAILED: 201 characters of alt text were accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.peel_media (peel_id, position, kind, url, alt)
    values ('20000000-0000-0000-0000-000000000001', 0, 'gif', 'https://example.com/a.gif', 'a gif');
  raise exception 'check 21 FAILED: two media in the same position were accepted';
exception when unique_violation then null; end $$;
insert into public.peels (id, title, user_id) values ('20000000-0000-0000-0000-00000000000c', 'peel with media', :'ada');
insert into public.peel_media (peel_id, position, kind, url, alt)
  values ('20000000-0000-0000-0000-00000000000c', 0, 'image', 'https://example.com/b.png', 'b');
delete from public.peels where id = '20000000-0000-0000-0000-00000000000c';
do $$ begin
  if exists (select 1 from public.peel_media where peel_id = '20000000-0000-0000-0000-00000000000c') then
    raise exception 'check 21 FAILED: composting a peel left its media behind';
  end if;
end $$;
\echo check 21 ok: media belongs to the peel author, is constrained, and cascades

-- 22. home_timeline merges peels and reposts on one clock. Fixed timestamps,
--     because everything above shares the transaction's now().
insert into public.peels (id, created_at, title, user_id) values
  ('30000000-0000-0000-0000-000000000001', '2020-01-01T00:00:00Z', 'older peel by bob', :'bob'),
  ('30000000-0000-0000-0000-000000000002', '2020-01-02T00:00:00Z', 'newer peel by cat', :'cat');
insert into public.peels (id, created_at, title, user_id, parent_id) values
  ('30000000-0000-0000-0000-000000000003', '2020-01-02T06:00:00Z', 'a reply, never on a timeline', :'cat',
   '30000000-0000-0000-0000-000000000001');
insert into public.reposts (user_id, peel_id, created_at)
  values (:'bob', '30000000-0000-0000-0000-000000000001', '2020-01-03T00:00:00Z');
delete from public.follows;
insert into public.follows (follower_id, followee_id) values (:'ada', :'bob');
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare rows text;
begin
  -- A repost carries its own time, so bob's repost of the oldest peel sits above
  -- the newer peel; the peel itself still appears at its own time underneath.
  -- Replies never appear at all.
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-') || '/' || t.sort_at::text, ' | '
                    order by t.sort_at desc)
    into rows
  from public.home_timeline(false, '2020-01-04T00:00:00Z', 100) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/2020-01-03 00:00:00+00 | '
     '30000000-0000-0000-0000-000000000002/-/2020-01-02 00:00:00+00 | '
     '30000000-0000-0000-0000-000000000001/-/2020-01-01 00:00:00+00' then
    raise exception 'check 22 FAILED: all-timeline came back as %', rows;
  end if;

  -- Following = who ada follows (bob) plus ada herself, so cat's peel drops out.
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ' order by t.sort_at desc)
    into rows
  from public.home_timeline(true, '2020-01-04T00:00:00Z', 100) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002 | '
     '30000000-0000-0000-0000-000000000001/-' then
    raise exception 'check 22 FAILED: following-timeline came back as %', rows;
  end if;

  -- The cursor is strict, so paging on the last row's sort_at never repeats it.
  if (select count(*) from public.home_timeline(false, '2020-01-03T00:00:00Z', 100)) <> 2 then
    raise exception 'check 22 FAILED: the before cursor did not exclude the repost';
  end if;
  -- page_size is clamped into 1..100 rather than trusted.
  if (select count(*) from public.home_timeline(false, '2020-01-04T00:00:00Z', 1)) <> 1
     or (select count(*) from public.home_timeline(false, '2020-01-04T00:00:00Z', 0)) <> 1
     or (select count(*) from public.home_timeline(false, '2020-01-04T00:00:00Z', -5)) <> 1 then
    raise exception 'check 22 FAILED: page_size is not clamped to at least 1';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  perform public.home_timeline(false, null, 10);
  raise exception 'check 22 FAILED: anon can read the home timeline';
exception when insufficient_privilege then null; end $$;
reset role;
\echo check 22 ok: home_timeline merges reposts by their own time, honours following_only, before and page_size

-- 23. seed_triggers is service-role only, twice over, and really does silence
--     the notification triggers while it is off.
set local role authenticated;
do $$ begin
  perform public.seed_triggers(false);
  raise exception 'check 23 FAILED: authenticated could call seed_triggers';
exception when insufficient_privilege then null; end $$;
reset role;
-- postgres owns the function, so the grant does not stop it; the body's claim
-- check has to. request.jwt.claims still says "authenticated" from above.
do $$ begin
  perform public.seed_triggers(false);
  raise exception 'check 23 FAILED: seed_triggers ran without a service_role claim';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.role', 'service_role', true) \gset
select public.seed_triggers(false) \gset seed_
do $$ begin
  if exists (select 1 from pg_trigger where tgname in
               ('notify_like','unnotify_like','notify_repost','unnotify_repost',
                'notify_follow','unnotify_follow','notify_peel')
             and tgenabled <> 'D') then
    raise exception 'check 23 FAILED: some notification triggers are still enabled';
  end if;
end $$;
delete from public.notifications;
insert into public.likes (user_id, peel_id) values (:'cat', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'check 23 FAILED: a like still notified while the triggers were off';
  end if;
end $$;
select public.seed_triggers(true) \gset seed_
delete from public.likes where user_id = :'cat' and peel_id = '20000000-0000-0000-0000-000000000001';
insert into public.likes (user_id, peel_id) values (:'cat', '20000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from public.notifications where type = 'like'
        and actor_id = '00000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'check 23 FAILED: turning the triggers back on did not restore notifications';
  end if;
end $$;
select set_config('request.jwt.claim.role', '', true) \gset
\echo check 23 ok: seed_triggers needs the service role and really does silence the triggers

-- 24. The storage half looks before it writes. This container ships an empty
--     `storage` schema (storage-api owns those tables), so the expected outcome
--     here is a clean skip rather than a failed migration; against a database
--     that does have Storage the same call has to produce the bucket.
do $$
declare status text; bucket record;
begin
  select public.ensure_media_bucket() into status;
  if to_regclass('storage.buckets') is null then
    if status not like 'skipped:%' then
      raise exception 'check 24 FAILED: no storage.buckets here, expected a skip, got %', status;
    end if;
  else
    execute 'select id, name, public from storage.buckets where id = ''media''' into bucket;
    if bucket.id is null or not bucket.public then
      raise exception 'check 24 FAILED: no public media bucket (%)', status;
    end if;
    if to_regclass('storage.objects') is not null
       and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname in ('media is publicly readable',
                                 'users upload media to their own folder',
                                 'users delete their own media')) <> 3 then
      raise exception 'check 24 FAILED: the media storage policies are missing (%)', status;
    end if;
  end if;
end $$;
\echo check 24 ok: the media bucket step is idempotent and skips cleanly without Storage

rollback;
\echo ALL CHECKS PASSED
