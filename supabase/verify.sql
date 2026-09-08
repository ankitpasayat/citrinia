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
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    raise exception 'check 5 FAILED: public.notifications not in supabase_realtime';
  end if;
  -- Without the whole old row, a DELETE event has no user_id for the bell's filter to match.
  if (select relreplident from pg_class where oid = 'public.notifications'::regclass) <> 'f' then
    raise exception 'check 5 FAILED: public.notifications needs replica identity full';
  end if;
end $$;
\echo check 5 ok: peels and notifications in supabase_realtime publication, notifications logged whole

-- 6. RLS enabled on every table, 43 policies, API roles have the grants their policies assume.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public'
               and tablename in ('profiles','peels','likes','follows','reposts','bookmarks','peel_media','notifications','username_history','reports','mutes','blocks','link_previews','conversations','messages')
               and not rowsecurity) then
    raise exception 'check 6 FAILED: RLS not enabled on every table';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 43 then
    raise exception 'check 6 FAILED: expected 43 policies, found %', (select count(*) from pg_policies where schemaname = 'public');
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
  -- The two RPCs are scoped by GRANT, not only by their bodies. The square is
  -- public, so the timeline is one a signed-out reader may ask for too.
  if not has_function_privilege('authenticated', 'public.home_timeline(boolean, timestamptz, int, uuid, uuid)', 'execute')
     or not has_function_privilege('anon', 'public.home_timeline(boolean, timestamptz, int, uuid, uuid)', 'execute') then
    raise exception 'check 6 FAILED: home_timeline execute grants are wrong';
  end if;
  -- The keyset migration replaced the three-argument version; an overload left
  -- behind would keep its own grants.
  if exists (select 1 from pg_proc where proname = 'home_timeline' and pronamespace = 'public'::regnamespace and pronargs <> 5) then
    raise exception 'check 6 FAILED: an old home_timeline overload is still defined';
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
\echo check 6 ok: RLS on, 43 policies, grants present

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

-- 8. The square is public: the anonymous role reads profiles AND peels.
set local role anon;
do $$ begin
  if (select count(*) from public.peels) = 0 then raise exception 'check 8 FAILED: anon cannot read peels'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'check 8 FAILED: anon cannot read profiles'; end if;
end $$;
reset role;
\echo check 8 ok: anon sees profiles and peels

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

-- 13. Anonymous role reads follows: who follows whom is on every public profile.
set local role anon;
do $$ begin
  if (select count(*) from public.follows) = 0 then raise exception 'check 13 FAILED: anon cannot read follows'; end if;
end $$;
reset role;
\echo check 13 ok: anon can read follows

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

  -- Ties. Ada (the caller, so RLS lets her) posts at the very instant cat did,
  -- and repeels cat's peel at that same instant: three rows on one clock tick,
  -- two of them the same peel. The order is time, then peel id, then who
  -- repeeled (a peel's own row last), and a cursor that names all three keys
  -- carries on from any of them without skipping or repeating a row.
  insert into public.peels (id, created_at, title, user_id)
    values ('30000000-0000-0000-0000-000000000004', '2020-01-02T00:00:00Z', 'ada, at the same instant', auth.uid());
  insert into public.reposts (user_id, peel_id, created_at)
    values (auth.uid(), '30000000-0000-0000-0000-000000000002', '2020-01-02T00:00:00Z');
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ')
    into rows
  from public.home_timeline(false, '2020-01-04T00:00:00Z', 100) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002 | '
     '30000000-0000-0000-0000-000000000004/- | '
     '30000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000001 | '
     '30000000-0000-0000-0000-000000000002/- | '
     '30000000-0000-0000-0000-000000000001/-' then
    raise exception 'check 22 FAILED: tied rows are not ordered by peel id then reposter, got %', rows;
  end if;
  -- A page of two ends inside the tie; the next page starts right after it.
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ')
    into rows
  from public.home_timeline(false, '2020-01-04T00:00:00Z', 2) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002 | '
     '30000000-0000-0000-0000-000000000004/-' then
    raise exception 'check 22 FAILED: a two-row page came back as %', rows;
  end if;
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ')
    into rows
  from public.home_timeline(false, '2020-01-02T00:00:00Z', 100, '30000000-0000-0000-0000-000000000004', null) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000001 | '
     '30000000-0000-0000-0000-000000000002/- | '
     '30000000-0000-0000-0000-000000000001/-' then
    raise exception 'check 22 FAILED: paging from inside a tie skipped or repeated a row, got %', rows;
  end if;
  -- From the repeel, the peel's own row is next; from the peel's own row, only older ones remain.
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ')
    into rows
  from public.home_timeline(false, '2020-01-02T00:00:00Z', 100, '30000000-0000-0000-0000-000000000002', auth.uid()) t;
  if rows is distinct from
     '30000000-0000-0000-0000-000000000002/- | 30000000-0000-0000-0000-000000000001/-' then
    raise exception 'check 22 FAILED: paging from a repeel came back as %', rows;
  end if;
  select string_agg(t.peel_id::text || '/' || coalesce(t.repost_by::text, '-'), ' | ')
    into rows
  from public.home_timeline(false, '2020-01-02T00:00:00Z', 100, '30000000-0000-0000-0000-000000000002', null) t;
  if rows is distinct from '30000000-0000-0000-0000-000000000001/-' then
    raise exception 'check 22 FAILED: paging from a peel at its own instant came back as %', rows;
  end if;
end $$;
reset role;
-- The same timeline, signed out. A real anon request carries the anon key and
-- no `sub`, so auth.uid() is null inside the function; the claims the block
-- above set are ada's and would send hidden_from looking for her blocks, which
-- anon may not read. Clearing them is what an actual signed-out call looks like.
set local role anon;
do $$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
do $$ begin
  if (select count(*) from public.home_timeline(false, null, 50)) = 0 then
    raise exception 'check 22 FAILED: the signed-out home timeline is empty';
  end if;
end $$;
reset role;
-- Check 23 below leans on request.jwt.claims still saying "authenticated".
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
\echo check 22 ok: home_timeline merges reposts by their own time, honours following_only, page_size and a three-key cursor, and reads signed out

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

-- 26. The service role holds table privileges on every public table (it bypasses RLS,
--     but only if the grants exist; the live project lacked them).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if not has_table_privilege('service_role', format('public.%I', t), 'select, insert, update, delete') then
      raise exception 'check 26 FAILED: service_role lacks privileges on public.%', t;
    end if;
  end loop;
end $$;
\echo check 26 ok: service_role can read and write every public table

-- 27. The thread page's ancestor walk: what a peel answers, root first, bounded,
--     and running as the reader so RLS still decides what is on the way up.
insert into public.peels (id, title, user_id, parent_id) values
  ('40000000-0000-0000-0000-000000000001', 'chain root', :'ada', null),
  ('40000000-0000-0000-0000-000000000002', 'chain a',    :'bob', '40000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000003', 'chain b',    :'ada', '40000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000004', 'chain leaf', :'bob', '40000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000005', 'off to one side', :'ada', '40000000-0000-0000-0000-000000000002');
do $$
declare walked uuid[];
begin
  -- `with ordinality` pins the order the function actually emits, not an order
  -- re-imposed here: the page renders these top to bottom as they come.
  select array_agg(a.id order by a.ord) into walked
    from public.peel_ancestors('40000000-0000-0000-0000-000000000004') with ordinality as a(id, depth, ord);
  if walked is distinct from array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'check 27 FAILED: expected root, a, b in that order and nothing off to the side, got %', walked;
  end if;

  -- A peel that starts a thread answers nothing.
  if (select count(*) from public.peel_ancestors('40000000-0000-0000-0000-000000000001')) <> 0 then
    raise exception 'check 27 FAILED: a top-level peel was given ancestors';
  end if;

  -- The cap keeps the NEAREST ancestors: losing the root is better than losing
  -- the peel the reply is actually answering.
  select array_agg(a.id order by a.ord) into walked
    from public.peel_ancestors('40000000-0000-0000-0000-000000000004', 2) with ordinality as a(id, depth, ord);
  if walked is distinct from array['40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'check 27 FAILED: max_depth 2 should keep the two nearest, got %', walked;
  end if;

  -- security invoker is the whole reason RLS still applies to the walk.
  if (select prosecdef from pg_proc where oid = 'public.peel_ancestors(uuid,int)'::regprocedure) then
    raise exception 'check 27 FAILED: peel_ancestors is security definer, so it would walk past RLS';
  end if;
  -- A thread is part of the public square, so the walk up it is too.
  if not has_function_privilege('anon', 'public.peel_ancestors(uuid,int)', 'execute') then
    raise exception 'check 27 FAILED: anon cannot execute peel_ancestors';
  end if;
  if not has_function_privilege('authenticated', 'public.peel_ancestors(uuid,int)', 'execute') then
    raise exception 'check 27 FAILED: authenticated cannot execute peel_ancestors';
  end if;
end $$;

-- A parent_id cycle is not reachable through the app, but nothing in the schema
-- forbids one either, and a recursive walk with no ceiling would never return.
update public.peels set parent_id = '40000000-0000-0000-0000-000000000004' where id = '40000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.peel_ancestors('40000000-0000-0000-0000-000000000004', 1000)) <> 100 then
    raise exception 'check 27 FAILED: a parent_id cycle did not stop at the 100 ceiling';
  end if;
end $$;
update public.peels set parent_id = null where id = '40000000-0000-0000-0000-000000000001';
\echo check 27 ok: peel_ancestors walks root-first, keeps the nearest under a cap, and cannot run away


-- 28. The profile's own fields. Their owner can write these straight through
--     PostgREST, so the constraints -- not the server action -- are what decide
--     what a profile may say, and the column grant is what keeps the handle out.
\set carol '50000000-0000-0000-0000-000000000001'

-- A url column that reaches an href or an <img src> takes https or nothing.
do $$ begin
  update public.profiles set website = 'javascript:alert(1)' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a javascript: url was storable as a website';
exception when check_violation then null; end $$;
do $$ begin
  update public.profiles set website = 'http://ada.example' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a cleartext website was accepted';
exception when check_violation then null; end $$;
do $$ begin
  update public.profiles set banner_url = 'javascript:alert(1)' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a javascript: url was storable as a banner';
exception when check_violation then null; end $$;
do $$ begin
  update public.profiles set avatar_url = 'data:text/html,<script>alert(1)</script>' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a data: url was storable as an avatar';
exception when check_violation then null; end $$;

-- A picture of ours may be a loopback url, because that is what a local
-- Supabase stack serves Storage over -- the same latitude peel_media.url gets.
update public.profiles set avatar_url = 'http://127.0.0.1:54321/storage/v1/object/public/avatars/u/a.png'
 where id = :'ada';
update public.profiles set banner_url = 'http://localhost:54321/storage/v1/object/public/avatars/u/b.png'
 where id = :'ada';
-- A website is a link pointing outward, so it gets none of that latitude.
do $$ begin
  update public.profiles set website = 'http://127.0.0.1:54321/' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a loopback website was accepted';
exception when check_violation then null; end $$;
-- Loopback is the only cleartext exception; a lookalike host is not loopback.
do $$ begin
  update public.profiles set avatar_url = 'http://127.0.0.1.evil.example/a.png' where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a host that merely starts with 127.0.0.1 passed as loopback';
exception when check_violation then null; end $$;

-- The lengths, at the boundary on both sides.
do $$ begin
  update public.profiles set location = repeat('x', 31) where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a 31-character location was accepted';
exception when check_violation then null; end $$;
do $$ begin
  update public.profiles set website = 'https://' || repeat('x', 93) where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 28 FAILED: a 101-character website was accepted';
exception when check_violation then null; end $$;

update public.profiles
   set website = 'https://ada.example', location = repeat('x', 30),
       banner_url = 'https://cdn.example/b.png', avatar_url = ''
 where id = :'ada';
do $$
declare p public.profiles%rowtype;
begin
  select * into strict p from public.profiles where id = '00000000-0000-0000-0000-000000000001';
  if p.website <> 'https://ada.example' or char_length(p.location) <> 30 or p.avatar_url <> '' then
    raise exception 'check 28 FAILED: a legal profile did not survive the round trip: %', p;
  end if;
end $$;

-- Every new column is "not set", never null, so no reader needs a fallback.
do $$
declare bad int;
begin
  select count(*) into bad from public.profiles
   where banner_url is null or location is null or website is null or created_at is null;
  if bad <> 0 then
    raise exception 'check 28 FAILED: % profiles carry a null in a not-null profile field', bad;
  end if;
end $$;

-- "Joined" is the account's date. The row is written by the signup trigger in
-- the same transaction as the auth user, so the two instants agree.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (:'carol', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@example.com',
        '{"provider":"github"}',
        '{"name":"Carol","user_name":"carol","avatar_url":"http://insecure.example/c.png"}',
        now(), now());
do $$
declare p public.profiles%rowtype;
declare u_at timestamptz;
begin
  select * into strict p from public.profiles where id = '50000000-0000-0000-0000-000000000001';
  select created_at into u_at from auth.users where id = '50000000-0000-0000-0000-000000000001';
  if abs(extract(epoch from (p.created_at - u_at))) > 1 then
    raise exception 'check 28 FAILED: joined date % is not the signup date %', p.created_at, u_at;
  end if;
  -- An avatar the constraint would reject must not abort the signup; it is dropped.
  if p.avatar_url <> '' then
    raise exception 'check 28 FAILED: a non-https avatar was kept as %', p.avatar_url;
  end if;
  if p.name <> 'Carol' then
    raise exception 'check 28 FAILED: the trigger rewrite lost the name, got %', p.name;
  end if;
end $$;

-- A provider that sends no avatar at all still gets an account.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'dan@example.com', '{"provider":"github"}', '{"user_name":"dan"}', now(), now());
do $$ begin
  if not exists (select 1 from public.profiles where id = '50000000-0000-0000-0000-000000000002' and avatar_url = '') then
    raise exception 'check 28 FAILED: a signup with no avatar did not produce a profile';
  end if;
end $$;

-- The grant is the only thing standing between a signed-in browser and its own
-- handle: the update policy allows the whole row, and a policy cannot see columns.
do $$
declare col text;
begin
  foreach col in array array['name','bio','location','website','avatar_url','banner_url'] loop
    if not has_column_privilege('authenticated', 'public.profiles', col, 'update') then
      raise exception 'check 28 FAILED: authenticated cannot update its own %', col;
    end if;
  end loop;
  foreach col in array array['username','id','created_at'] loop
    if has_column_privilege('authenticated', 'public.profiles', col, 'update') then
      raise exception 'check 28 FAILED: authenticated can rewrite %', col;
    end if;
  end loop;
  if has_column_privilege('anon', 'public.profiles', 'name', 'update') then
    raise exception 'check 28 FAILED: a signed-out reader can edit a profile';
  end if;
end $$;

-- The bucket helper is the migration's own tool, not an API.
do $$ begin
  if to_regprocedure('public.ensure_public_bucket(text,bigint,text[])') is null then
    raise exception 'check 28 FAILED: ensure_public_bucket is missing';
  end if;
  if has_function_privilege('anon', 'public.ensure_public_bucket(text,bigint,text[])', 'execute')
     or has_function_privilege('authenticated', 'public.ensure_public_bucket(text,bigint,text[])', 'execute') then
    raise exception 'check 28 FAILED: a client can create Storage buckets';
  end if;
end $$;
\echo check 28 ok: profile fields take https or nothing, joined is the signup date, and the handle stays ungranted

-- 29. The pin: a profile leads with one of its own peels, and only its own.
do $$ begin
  update public.profiles set pinned_peel_id = (select id from public.peels where user_id = '00000000-0000-0000-0000-000000000002' limit 1)
   where id = '00000000-0000-0000-0000-000000000001';
  raise exception 'check 29 FAILED: ada pinned one of bob''s peels';
exception when check_violation then null; end $$;

-- Your own is fine, and composting it puts the profile back rather than taking
-- it down: the reference is "set null", not "cascade".
do $$
declare mine uuid;
begin
  insert into public.peels (title, user_id) values ('worth leading with', '00000000-0000-0000-0000-000000000001')
    returning id into mine;
  update public.profiles set pinned_peel_id = mine where id = '00000000-0000-0000-0000-000000000001';
  if (select pinned_peel_id from public.profiles where id = '00000000-0000-0000-0000-000000000001') <> mine then
    raise exception 'check 29 FAILED: pinning your own peel did not stick';
  end if;

  delete from public.peels where id = mine;
  if not exists (select 1 from public.profiles
                  where id = '00000000-0000-0000-0000-000000000001' and pinned_peel_id is null) then
    raise exception 'check 29 FAILED: composting the pinned peel did not unpin it';
  end if;
end $$;

-- Nothing pinned is the ordinary state, so null has to be storable.
update public.profiles set pinned_peel_id = null where id = :'ada';

-- The pin is the owner's to set, and nobody else's.
do $$ begin
  if not has_column_privilege('authenticated', 'public.profiles', 'pinned_peel_id', 'update') then
    raise exception 'check 29 FAILED: authenticated cannot pin its own peel';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'pinned_peel_id', 'update') then
    raise exception 'check 29 FAILED: a signed-out reader can pin a peel';
  end if;
end $$;
\echo check 29 ok: a pinned peel must be your own, and composting it only unpins it

-- 30. Renaming: one case, one owner, a 30-day hold on the handle you let go,
--     and an old handle that still points at you.
do $$ begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'profiles_username_unique') then
    raise exception 'check 30 FAILED: nothing stops two profiles sharing a handle';
  end if;
end $$;

-- Handles are stored lower case, whatever the provider sent.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'eve@example.com', '{"provider":"github"}', '{"user_name":"EveWithCaps","avatar_url":"https://e.example/e.png"}',
        now(), now());
do $$ begin
  if (select username from public.profiles where id = '60000000-0000-0000-0000-000000000001') <> 'evewithcaps' then
    raise exception 'check 30 FAILED: a capitalised login was stored as-is, so no mention of it could resolve';
  end if;
end $$;

-- Two profiles cannot hold the same handle in different cases.
do $$ begin
  update public.profiles set username = 'ADA' where id = '60000000-0000-0000-0000-000000000001';
  raise exception 'check 30 FAILED: EveWithCaps took ada''s handle by capitalising it';
exception when unique_violation then null; end $$;

-- change_username() acts for the caller, so the checks below run as one. Both
-- GUCs, because auth.uid() reads the older singular one on some images and the
-- json one on others -- and a check that silently runs as the previous test's
-- user proves nothing (this one did, until it was caught).
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

do $$ begin
  perform public.change_username('no');
  raise exception 'check 30 FAILED: a two-character handle was accepted';
exception when check_violation then null; end $$;
do $$ begin
  perform public.change_username('nope!');
  raise exception 'check 30 FAILED: a handle with punctuation was accepted';
exception when check_violation then null; end $$;
do $$ begin
  perform public.change_username(repeat('a', 21));
  raise exception 'check 30 FAILED: a 21-character handle was accepted';
exception when check_violation then null; end $$;
do $$ begin
  perform public.change_username('bob');
  raise exception 'check 30 FAILED: ada took a handle somebody is using';
exception when unique_violation then null; end $$;

-- Asking for the handle you already have changes nothing, and above all does
-- not record it as released. Two things guarantee that -- the early return and
-- the delete below it -- so removing either one alone leaves this green; it
-- goes red when both are gone, which is what makes it worth asserting.
do $$ begin
  if public.change_username('ADA') <> 'ada' then
    raise exception 'check 30 FAILED: renaming to your own handle did not leave it alone';
  end if;
  if exists (select 1 from public.username_history where username = 'ada') then
    raise exception 'check 30 FAILED: renaming to your own handle put it on hold';
  end if;
end $$;

-- The rename itself: stored lower case, and the old handle now leads here.
do $$ begin
  if public.change_username('Ada_Lovelace') <> 'ada_lovelace' then
    raise exception 'check 30 FAILED: the new handle came back in the wrong case';
  end if;
  if (select username from public.profiles where id = '00000000-0000-0000-0000-000000000001') <> 'ada_lovelace' then
    raise exception 'check 30 FAILED: the profile kept its old handle';
  end if;
  if not exists (select 1 from public.username_history
                  where username = 'ada' and profile_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'check 30 FAILED: the handle ada was let go without leaving a forwarding address';
  end if;
end $$;

-- Taking your own old handle back is always allowed, and stops it forwarding.
do $$ begin
  perform public.change_username('ada');
  if exists (select 1 from public.username_history where username = 'ada') then
    raise exception 'check 30 FAILED: reclaiming a handle left it forwarding to itself';
  end if;
  if not exists (select 1 from public.username_history where username = 'ada_lovelace') then
    raise exception 'check 30 FAILED: ada_lovelace was let go without leaving a forwarding address';
  end if;
end $$;

-- The hold is one-sided: bob cannot have what ada just let go of.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  perform public.change_username('ada_lovelace');
  raise exception 'check 30 FAILED: bob took a handle that was released moments ago';
exception when check_violation then null; end $$;

-- Thirty days and a moment later, it is anybody's.
reset role;
update public.username_history set released_at = now() - interval '30 days 1 minute'
 where username = 'ada_lovelace';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if public.change_username('ada_lovelace') <> 'ada_lovelace' then
    raise exception 'check 30 FAILED: an expired hold still blocked the handle';
  end if;
end $$;

-- The history is readable (the redirect is a read) and writable by nobody: a
-- forwarding address you could forge is a way to take somebody else's traffic.
do $$ begin
  if not has_table_privilege('authenticated', 'public.username_history', 'select') then
    raise exception 'check 30 FAILED: the redirect cannot read the history';
  end if;
  if has_table_privilege('authenticated', 'public.username_history', 'insert')
     or has_table_privilege('authenticated', 'public.username_history', 'update')
     or has_table_privilege('authenticated', 'public.username_history', 'delete') then
    raise exception 'check 30 FAILED: a client can forge a forwarding address';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'username', 'update') then
    raise exception 'check 30 FAILED: username is writable without going through change_username';
  end if;
  if has_function_privilege('anon', 'public.change_username(text)', 'execute') then
    raise exception 'check 30 FAILED: a signed-out caller can rename somebody';
  end if;
end $$;

reset role;
\echo check 30 ok: handles are lower case and unique, a rename forwards the old one, and the hold is one-sided

-- 31. The entire grant surface for the two API roles, as one list.
-- Supabase's default privileges hand anon and authenticated ALL on every new
-- table in public, so a table added by a later migration is wide open until
-- something says otherwise. 20260913000000_column_grants.sql revokes and
-- re-grants; this is what holds that line for tables nobody has written yet.
do $$
declare actual text; expected text;
begin
  select coalesce(string_agg(grantee || ' ' || table_name || ' ' || privilege_type, E'\n'
                             order by grantee, table_name, privilege_type), '(none)')
    into actual
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated');
  expected :=
    'anon bookmarks SELECT'                  || E'\n' ||
    'anon follows SELECT'                    || E'\n' ||
    'anon likes SELECT'                      || E'\n' ||
    'anon link_previews SELECT'              || E'\n' ||
    'anon peel_media SELECT'                 || E'\n' ||
    'anon peels SELECT'                      || E'\n' ||
    'anon profiles SELECT'                   || E'\n' ||
    'anon reposts SELECT'                    || E'\n' ||
    'anon username_history SELECT'           || E'\n' ||
    'authenticated blocks DELETE'            || E'\n' ||
    'authenticated blocks INSERT'            || E'\n' ||
    'authenticated blocks SELECT'            || E'\n' ||
    'authenticated bookmarks DELETE'         || E'\n' ||
    'authenticated bookmarks INSERT'         || E'\n' ||
    'authenticated bookmarks SELECT'         || E'\n' ||
    'authenticated conversations DELETE'     || E'\n' ||
    'authenticated conversations INSERT'     || E'\n' ||
    'authenticated conversations SELECT'     || E'\n' ||
    'authenticated follows DELETE'           || E'\n' ||
    'authenticated follows INSERT'           || E'\n' ||
    'authenticated follows SELECT'           || E'\n' ||
    'authenticated likes DELETE'             || E'\n' ||
    'authenticated likes INSERT'             || E'\n' ||
    'authenticated likes SELECT'             || E'\n' ||
    'authenticated link_previews INSERT'     || E'\n' ||
    'authenticated link_previews SELECT'     || E'\n' ||
    'authenticated messages INSERT'          || E'\n' ||
    'authenticated messages SELECT'          || E'\n' ||
    'authenticated mutes DELETE'             || E'\n' ||
    'authenticated mutes INSERT'             || E'\n' ||
    'authenticated mutes SELECT'             || E'\n' ||
    'authenticated notifications SELECT'     || E'\n' ||
    'authenticated peel_media DELETE'        || E'\n' ||
    'authenticated peel_media INSERT'        || E'\n' ||
    'authenticated peel_media SELECT'        || E'\n' ||
    'authenticated peels DELETE'             || E'\n' ||
    'authenticated peels INSERT'             || E'\n' ||
    'authenticated peels SELECT'             || E'\n' ||
    'authenticated profiles SELECT'          || E'\n' ||
    'authenticated reports INSERT'           || E'\n' ||
    'authenticated reposts DELETE'           || E'\n' ||
    'authenticated reposts INSERT'           || E'\n' ||
    'authenticated reposts SELECT'           || E'\n' ||
    'authenticated username_history SELECT';
  if actual <> expected then
    raise exception E'check 31 FAILED: table grants drifted.\n--- got ---\n%\n--- want ---\n%', actual, expected;
  end if;
end $$;

-- The same list at column level: UPDATE is granted nowhere table-wide, so every
-- updatable column has to be named.
do $$
declare actual text; expected text;
begin
  select coalesce(string_agg(grantee || ' ' || table_name || '.' || column_name, E'\n'
                             order by grantee, table_name, column_name), '(none)')
    into actual
    from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type = 'UPDATE';
  expected :=
    'authenticated notifications.read_at'    || E'\n' ||
    'authenticated profiles.avatar_url'      || E'\n' ||
    'authenticated profiles.banner_url'      || E'\n' ||
    'authenticated profiles.bio'             || E'\n' ||
    'authenticated profiles.location'        || E'\n' ||
    'authenticated profiles.name'            || E'\n' ||
    'authenticated profiles.pinned_peel_id'  || E'\n' ||
    'authenticated profiles.website';
  if actual <> expected then
    raise exception E'check 31 FAILED: updatable columns drifted.\n--- got ---\n%\n--- want ---\n%', actual, expected;
  end if;
end $$;
\echo check 31 ok: the API roles hold exactly the listed table and column grants

-- 32. Reports: one subject, a reason from the list, filed as yourself, once,
--     and readable by nobody through the API.
-- Its own ground: two accounts and a peel that no earlier check has touched.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'quinn@example.com', '{"provider":"github"}', '{"user_name":"quinnverify","avatar_url":""}', now(), now()),
       ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'rhea@example.com', '{"provider":"github"}', '{"user_name":"rheaverify","avatar_url":""}', now(), now());
insert into public.peels (id, title, user_id)
values ('71000000-0000-0000-0000-000000000001', 'something worth flagging', '70000000-0000-0000-0000-000000000002');

-- The shape rules hold before anybody's identity is involved.
do $$ begin
  insert into public.reports (reporter_id, reason) values ('70000000-0000-0000-0000-000000000001', 'spam');
  raise exception 'check 32 FAILED: a report about nothing was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.reports (reporter_id, peel_id, profile_id, reason)
  values ('70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-000000000002', 'spam');
  raise exception 'check 32 FAILED: a report of a peel AND a profile was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.reports (reporter_id, peel_id, reason)
  values ('70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'because i said so');
  raise exception 'check 32 FAILED: a reason outside the list was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.reports (reporter_id, peel_id, reason, note)
  values ('70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'other', repeat('x', 281));
  raise exception 'check 32 FAILED: a 281-character note was accepted';
exception when check_violation then null; end $$;

-- Filing one is something a person does, so the rest runs as one. Both GUCs;
-- see the note on check 30.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

insert into public.reports (reporter_id, peel_id, reason)
values ('70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'spam');

-- The same peel again is not more information, and is what stops a loop filling
-- the table. A different subject by the same person is a different report.
do $$ begin
  insert into public.reports (reporter_id, peel_id, reason, note)
  values ('70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'abuse', 'again');
  raise exception 'check 32 FAILED: the same peel was reported twice by the same person';
exception when unique_violation then null; end $$;
insert into public.reports (reporter_id, profile_id, reason, note)
values ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'abuse', 'and the person too');

-- A report names who filed it, so filing one under somebody else's name would be
-- a way to put words in their mouth in the one place staff will read.
do $$ begin
  insert into public.reports (reporter_id, peel_id, reason)
  values ('70000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 'spam');
  raise exception 'check 32 FAILED: quinn filed a report as rhea';
exception when insufficient_privilege then null; end $$;

reset role;

do $$ begin
  if (select count(*) from public.reports where reporter_id = '70000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'check 32 FAILED: expected quinn to have filed exactly two reports';
  end if;
  -- Insert and nothing else. A readable queue would publish who reported whom.
  if not has_table_privilege('authenticated', 'public.reports', 'insert') then
    raise exception 'check 32 FAILED: a signed-in user cannot report anything';
  end if;
  if has_table_privilege('authenticated', 'public.reports', 'select')
     or has_table_privilege('authenticated', 'public.reports', 'update')
     or has_table_privilege('authenticated', 'public.reports', 'delete') then
    raise exception 'check 32 FAILED: a signed-in user can read back or edit the report queue';
  end if;
  if has_table_privilege('anon', 'public.reports', 'insert')
     or has_table_privilege('anon', 'public.reports', 'select') then
    raise exception 'check 32 FAILED: a signed-out visitor can reach the report queue';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and cmd <> 'INSERT') then
    raise exception 'check 32 FAILED: reports has a policy for something other than filing one';
  end if;
end $$;
\echo check 32 ok: a report has one subject, a listed reason, your name on it, and no way back out

-- 33. Deleting your account: the typed handle has to be yours, and the auth row
--     takes everything of yours with it and nothing of anybody else's.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

do $$ begin
  perform public.delete_account('rheaverify');
  raise exception 'check 33 FAILED: somebody else''s handle confirmed quinn''s deletion';
exception when check_violation then null; end $$;
do $$ begin
  perform public.delete_account('');
  raise exception 'check 33 FAILED: an empty confirmation deleted the account';
exception when check_violation then null; end $$;

reset role;
do $$ begin
  if not exists (select 1 from auth.users where id = '70000000-0000-0000-0000-000000000001') then
    raise exception 'check 33 FAILED: a refused confirmation deleted the account anyway';
  end if;
end $$;

-- The handle as somebody types it: their own case, and the @ they did not mean.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$ begin perform public.delete_account('  @QuinnVerify  '); end $$;
reset role;

do $$ begin
  if exists (select 1 from auth.users where id = '70000000-0000-0000-0000-000000000001') then
    raise exception 'check 33 FAILED: the auth row survived';
  end if;
  if exists (select 1 from public.profiles where id = '70000000-0000-0000-0000-000000000001') then
    raise exception 'check 33 FAILED: the profile survived';
  end if;
  if exists (select 1 from public.reports where reporter_id = '70000000-0000-0000-0000-000000000001') then
    raise exception 'check 33 FAILED: the reports she filed survived, still naming her';
  end if;
  -- Leaving takes your things, not the things you looked at.
  if not exists (select 1 from public.peels where id = '71000000-0000-0000-0000-000000000001') then
    raise exception 'check 33 FAILED: deleting an account took somebody else''s peel';
  end if;
  if not exists (select 1 from auth.users where id = '70000000-0000-0000-0000-000000000002') then
    raise exception 'check 33 FAILED: deleting an account took somebody else''s account';
  end if;
  if has_function_privilege('anon', 'public.delete_account(text)', 'execute') then
    raise exception 'check 33 FAILED: a signed-out caller can delete an account';
  end if;
end $$;
\echo check 33 ok: the way out needs your own handle, and takes only what is yours

-- 34. Mute: private, one-sided, and quiet.
-- Its own ground, since check 33 deleted quinn: three fresh accounts and a peel
-- each, so nothing here depends on what earlier checks left behind.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'sam@example.com', '{"provider":"github"}', '{"user_name":"samverify","avatar_url":""}', now(), now()),
       ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'tess@example.com', '{"provider":"github"}', '{"user_name":"tessverify","avatar_url":""}', now(), now()),
       ('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'uma@example.com', '{"provider":"github"}', '{"user_name":"umaverify","avatar_url":""}', now(), now());

-- The shape rules, before anybody's identity is involved.
do $$ begin
  insert into public.mutes (muter_id, muted_id)
  values ('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001');
  raise exception 'check 34 FAILED: somebody muted themselves';
exception when check_violation then null; end $$;

-- Sam mutes Tess. Everything below is from inside Sam's session.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

insert into public.mutes (muter_id, muted_id)
values ('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002');

do $$ begin
  insert into public.mutes (muter_id, muted_id)
  values ('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002');
  raise exception 'check 34 FAILED: the same person was muted twice';
exception when unique_violation then null; end $$;

-- Muting on somebody else's behalf would be a way to cut them off from a person.
do $$ begin
  insert into public.mutes (muter_id, muted_id)
  values ('80000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002');
  raise exception 'check 34 FAILED: sam muted somebody as uma';
exception when insufficient_privilege then null; end $$;

-- Sam reads their own mute, and hidden_from() agrees with it.
do $$ begin
  if not exists (select 1 from public.mutes m
                  where m.muter_id = '80000000-0000-0000-0000-000000000001'
                    and m.muted_id = '80000000-0000-0000-0000-000000000002') then
    raise exception 'check 34 FAILED: sam cannot see the mute sam just made';
  end if;
  if not public.hidden_from('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002') then
    raise exception 'check 34 FAILED: hidden_from does not know about the mute';
  end if;
  -- One-sided: muting somebody does not hide the muter from them.
  if public.hidden_from('80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001') then
    raise exception 'check 34 FAILED: a mute went both ways';
  end if;
end $$;

-- "Do they know? No." Tess is the muted party and must not be able to find out,
-- through the table or through the function -- which is exactly why hidden_from
-- is security INVOKER: it cannot see what its caller cannot see. A definer
-- version would answer this truthfully and publish the whole mute graph.
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if exists (select 1 from public.mutes) then
    raise exception 'check 34 FAILED: the muted party can read the mute';
  end if;
  if public.hidden_from('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002') then
    raise exception 'check 34 FAILED: hidden_from told the muted party they are muted';
  end if;
end $$;

-- Nobody can unmute on somebody else's behalf either: a delete that reaches
-- another person's row would undo a mute they still want.
do $$ begin
  delete from public.mutes;
  if (select count(*) from public.mutes m0) <> 0 then
    raise exception 'check 34 FAILED: unreachable';
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.mutes
                  where muter_id = '80000000-0000-0000-0000-000000000001') then
    raise exception 'check 34 FAILED: tess deleted a mute that was not hers';
  end if;
  -- A signed-out reader calls this with a null viewer and gets false without
  -- the function naming a table; with a real viewer it still reaches
  -- blocks_between and mutes, which anon holds nothing on, so the grant
  -- publishes no mute. See 20260921000000_public_square.sql and check 51.
  if not has_function_privilege('anon', 'public.hidden_from(uuid, uuid)', 'execute') then
    raise exception 'check 34 FAILED: a signed-out reader cannot ask about nobody';
  end if;
end $$;
\echo check 34 ok: a mute is the muter''s alone, one-sided, and invisible to the muted

-- 35. The home timeline drops a muted person's peels AND their reposts.
-- Filtering in the app instead would hand back short pages and a cursor that
-- skips, so this is the check that says the filter is where the page size is.
insert into public.peels (id, title, user_id)
values ('81000000-0000-0000-0000-000000000001', 'sam says hello', '80000000-0000-0000-0000-000000000001'),
       ('81000000-0000-0000-0000-000000000002', 'tess says hello', '80000000-0000-0000-0000-000000000002'),
       ('81000000-0000-0000-0000-000000000003', 'uma says hello', '80000000-0000-0000-0000-000000000003');
-- Tess repeels Uma's peel: the peel is fine, the person putting it in front of
-- Sam is not.
insert into public.reposts (peel_id, user_id)
values ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare ids uuid[];
begin
  select array_agg(t.peel_id order by t.peel_id) into ids
    from public.home_timeline(false, null, 100) t
   where t.peel_id in ('81000000-0000-0000-0000-000000000001',
                       '81000000-0000-0000-0000-000000000002',
                       '81000000-0000-0000-0000-000000000003');
  if '81000000-0000-0000-0000-000000000002'::uuid = any (ids) then
    raise exception 'check 35 FAILED: a muted person''s peel is still in the feed';
  end if;
  if not ('81000000-0000-0000-0000-000000000001'::uuid = any (ids)) then
    raise exception 'check 35 FAILED: a mute swallowed the reader''s own peel';
  end if;
  -- Uma's peel is still there once, as Uma's -- but not a second time as Tess's repeel.
  if not ('81000000-0000-0000-0000-000000000003'::uuid = any (ids)) then
    raise exception 'check 35 FAILED: a mute swallowed an unmuted person''s peel';
  end if;
  if exists (select 1 from public.home_timeline(false, null, 100) t
              where t.repost_by = '80000000-0000-0000-0000-000000000002') then
    raise exception 'check 35 FAILED: a muted person''s repeel is still in the feed';
  end if;
end $$;
reset role;

-- And the muted person's own peel is untouched for everybody else, which is the
-- line between muting somebody and blocking them.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
do $$ begin
  if not exists (select 1 from public.home_timeline(false, null, 100) t
                  where t.peel_id = '81000000-0000-0000-0000-000000000002') then
    raise exception 'check 35 FAILED: sam''s mute hid tess from uma as well';
  end if;
  if not exists (select 1 from public.peels where id = '81000000-0000-0000-0000-000000000002') then
    raise exception 'check 35 FAILED: a mute took the peel out of the table, not just the feed';
  end if;
end $$;
reset role;
\echo check 35 ok: the feed drops a muted person''s peels and repeels, and only for the muter

-- 36. The bell says nothing about somebody you muted.
-- Every notification is "actor did something to user", so every trigger asks the
-- same question. The triggers are security definer, which is what lets
-- hidden_from() read the RECIPIENT'S mutes while the ACTOR holds the session.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;

-- Tess likes, repeels, follows, replies to and mentions Sam. Sam muted Tess.
insert into public.likes (peel_id, user_id)
values ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002');
insert into public.reposts (peel_id, user_id)
values ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002');
insert into public.follows (follower_id, followee_id)
values ('80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001');
insert into public.peels (id, title, user_id, parent_id)
values ('81000000-0000-0000-0000-000000000004', 'replying to sam', '80000000-0000-0000-0000-000000000002',
        '81000000-0000-0000-0000-000000000001');
insert into public.peels (id, title, user_id)
values ('81000000-0000-0000-0000-000000000005', 'hey @samverify', '80000000-0000-0000-0000-000000000002');
insert into public.peels (id, title, user_id, quote_id)
values ('81000000-0000-0000-0000-000000000006', 'quoting sam', '80000000-0000-0000-0000-000000000002',
        '81000000-0000-0000-0000-000000000001');

reset role;
do $$
declare leaked text;
begin
  select string_agg(n.type, ', ' order by n.type) into leaked
    from public.notifications n
   where n.user_id = '80000000-0000-0000-0000-000000000001'
     and n.actor_id = '80000000-0000-0000-0000-000000000002';
  if leaked is not null then
    raise exception 'check 36 FAILED: a muted person rang the bell: %', leaked;
  end if;
end $$;

-- The same six actions towards Uma, who muted nobody, still all arrive -- so the
-- check above is proving a mute, not a broken trigger. Uma gets a second peel of
-- her own to be repeeled: check 35 already used the first one, and inheriting
-- another check's rows is how a test starts passing for the wrong reason.
insert into public.peels (id, title, user_id)
values ('81000000-0000-0000-0000-00000000000a', 'uma says hello again', '80000000-0000-0000-0000-000000000003');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
insert into public.likes (peel_id, user_id)
values ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002');
insert into public.reposts (peel_id, user_id)
values ('81000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000002');
insert into public.follows (follower_id, followee_id)
values ('80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000003');
insert into public.peels (id, title, user_id, parent_id)
values ('81000000-0000-0000-0000-000000000007', 'replying to uma', '80000000-0000-0000-0000-000000000002',
        '81000000-0000-0000-0000-000000000003');
insert into public.peels (id, title, user_id)
values ('81000000-0000-0000-0000-000000000008', 'hey @umaverify', '80000000-0000-0000-0000-000000000002');
insert into public.peels (id, title, user_id, quote_id)
values ('81000000-0000-0000-0000-000000000009', 'quoting uma', '80000000-0000-0000-0000-000000000002',
        '81000000-0000-0000-0000-000000000003');
reset role;
do $$
declare got text; want text := 'follow, like, mention, quote, reply, repost';
begin
  select string_agg(distinct n.type, ', ' order by n.type) into got
    from public.notifications n
   where n.user_id = '80000000-0000-0000-0000-000000000003'
     and n.actor_id = '80000000-0000-0000-0000-000000000002';
  if got is distinct from want then
    raise exception 'check 36 FAILED: an unmuted person''s notifications did not all arrive. got: %, want: %', got, want;
  end if;
end $$;
\echo check 36 ok: a muted person rings no bell, and an unmuted one rings every one

-- 37. Block: a rule about two people, that both of them can read and only one
--     of them can change.
-- Its own ground again: Vic and Wren, untouched by anything above.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'vic@example.com', '{"provider":"github"}', '{"user_name":"vicverify","avatar_url":""}', now(), now()),
       ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'wren@example.com', '{"provider":"github"}', '{"user_name":"wrenverify","avatar_url":""}', now(), now());
insert into public.peels (id, title, user_id)
values ('91000000-0000-0000-0000-000000000001', 'vic says something', '90000000-0000-0000-0000-000000000001'),
       ('91000000-0000-0000-0000-000000000002', 'wren says something', '90000000-0000-0000-0000-000000000002');
-- They follow each other, so the severing below has something to sever.
insert into public.follows (follower_id, followee_id)
values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'),
       ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001');

do $$ begin
  insert into public.blocks (blocker_id, blocked_id)
  values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001');
  raise exception 'check 37 FAILED: somebody blocked themselves';
exception when check_violation then null; end $$;

-- Vic blocks Wren.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

insert into public.blocks (blocker_id, blocked_id)
values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');

do $$ begin
  insert into public.blocks (blocker_id, blocked_id)
  values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');
  raise exception 'check 37 FAILED: the same person was blocked twice';
exception when unique_violation then null; end $$;

do $$ begin
  insert into public.blocks (blocker_id, blocked_id)
  values ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001');
  raise exception 'check 37 FAILED: vic blocked somebody as wren';
exception when insufficient_privilege then null; end $$;

-- The follows went, both ways, without vic being able to reach wren's row.
reset role;
do $$ begin
  if exists (select 1 from public.follows f
              where f.follower_id in ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002')
                and f.followee_id in ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002')) then
    raise exception 'check 37 FAILED: a block left a follow standing';
  end if;
end $$;

-- Wren is told. This is the one thing a block does that a mute does not, and it
-- is why the blocks policy lets the target read the row.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if not exists (select 1 from public.blocks b
                  where b.blocker_id = '90000000-0000-0000-0000-000000000001'
                    and b.blocked_id = '90000000-0000-0000-0000-000000000002') then
    raise exception 'check 37 FAILED: the blocked party cannot see that they are blocked';
  end if;
  -- Being told is not being able to undo it.
  delete from public.blocks;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.blocks
                  where blocker_id = '90000000-0000-0000-0000-000000000001') then
    raise exception 'check 37 FAILED: the blocked party unblocked themselves';
  end if;
end $$;

-- Somebody outside the pair learns nothing, and neither function is reachable
-- signed out.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
do $$ begin
  if exists (select 1 from public.blocks) then
    raise exception 'check 37 FAILED: a stranger can read who blocked whom';
  end if;
  if public.blocks_between('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002') then
    raise exception 'check 37 FAILED: blocks_between told a stranger about somebody else''s block';
  end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.blocks_between(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.blocked_ids()', 'execute')
     or has_function_privilege('anon', 'public.blocked_peel(uuid)', 'execute') then
    raise exception 'check 37 FAILED: a signed-out caller can ask about blocks';
  end if;
end $$;
\echo check 37 ok: a block is readable by both, changeable by one, and severs the follows

-- 38. The peels a block hides, hidden by the policy rather than by a query.
-- Both directions from one rule: vic blocked wren, so neither sees the other.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$ begin
  if exists (select 1 from public.peels where id = '91000000-0000-0000-0000-000000000002') then
    raise exception 'check 38 FAILED: the blocker can still read the blocked person''s peel';
  end if;
  if not exists (select 1 from public.peels where id = '91000000-0000-0000-0000-000000000001') then
    raise exception 'check 38 FAILED: a block swallowed the blocker''s own peel';
  end if;
  if exists (select 1 from public.home_timeline(false, null, 100) t
              where t.peel_id = '91000000-0000-0000-0000-000000000002') then
    raise exception 'check 38 FAILED: a blocked person''s peel is still in the feed';
  end if;
end $$;

do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  -- The half people forget: the person who did NOT block also stops seeing.
  if exists (select 1 from public.peels where id = '91000000-0000-0000-0000-000000000001') then
    raise exception 'check 38 FAILED: the blocked person can still read the blocker''s peels';
  end if;
  if not exists (select 1 from public.peels where id = '91000000-0000-0000-0000-000000000002') then
    raise exception 'check 38 FAILED: a block swallowed the blocked person''s own peel';
  end if;
end $$;
reset role;

-- And nobody else is touched by somebody else's block.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
do $$ begin
  if (select count(*) from public.peels
       where id in ('91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002')) <> 2 then
    raise exception 'check 38 FAILED: a block hid peels from somebody outside it';
  end if;
end $$;
reset role;
\echo check 38 ok: a block hides both people''s peels from each other, and nobody else''s

-- 39. Nothing attaches to a peel across a block.
-- The SELECT policy hides the peel, but an insert naming it by id is not a
-- select, and the foreign key check runs past RLS -- so each of these is its own
-- rule, and each is worth its own line here.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  insert into public.peels (title, user_id, parent_id)
  values ('replying across a block', '90000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001');
  raise exception 'check 39 FAILED: a blocked person replied to the blocker';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.peels (title, user_id, quote_id)
  values ('quoting across a block', '90000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001');
  raise exception 'check 39 FAILED: a blocked person quoted the blocker';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.likes (peel_id, user_id)
  values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');
  raise exception 'check 39 FAILED: a blocked person liked the blocker''s peel';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.reposts (peel_id, user_id)
  values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');
  raise exception 'check 39 FAILED: a blocked person repeeled the blocker''s peel';
exception when insufficient_privilege then null; end $$;

-- It runs the other way too: blocking somebody is not a way to keep replying to
-- them while they cannot answer.
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$ begin
  insert into public.peels (title, user_id, parent_id)
  values ('replying to the person i blocked', '90000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002');
  raise exception 'check 39 FAILED: the blocker replied to the person they blocked';
exception when insufficient_privilege then null; end $$;

-- A peel that is nobody's business but their own still goes in, so the rules
-- above are about the block and not about a broken insert policy.
insert into public.peels (title, user_id) values ('vic carries on', '90000000-0000-0000-0000-000000000001');
insert into public.peels (title, user_id, parent_id)
values ('vic answers uma', '90000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003');
insert into public.likes (peel_id, user_id)
values ('81000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001');
reset role;
\echo check 39 ok: no reply, quote, like or repeel crosses a block, in either direction

-- 40. Following across a block, and what unblocking does not undo.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  insert into public.follows (follower_id, followee_id)
  values ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001');
  raise exception 'check 40 FAILED: a blocked person followed the blocker';
exception when insufficient_privilege then null; end $$;

do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$ begin
  insert into public.follows (follower_id, followee_id)
  values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');
  raise exception 'check 40 FAILED: the blocker followed the person they blocked';
exception when insufficient_privilege then null; end $$;

-- Unblocking gives the peels back and nothing else: the follows stay gone,
-- because quietly re-following somebody you had blocked is a worse surprise
-- than pressing the button again.
delete from public.blocks where blocked_id = '90000000-0000-0000-0000-000000000002';
do $$ begin
  if not exists (select 1 from public.peels where id = '91000000-0000-0000-0000-000000000002') then
    raise exception 'check 40 FAILED: unblocking did not give the peels back';
  end if;
  if exists (select 1 from public.follows f
              where f.follower_id in ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002')
                and f.followee_id in ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002')) then
    raise exception 'check 40 FAILED: unblocking silently put the follows back';
  end if;
  -- And following again is allowed once more.
  insert into public.follows (follower_id, followee_id)
  values ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');
end $$;
reset role;
\echo check 40 ok: no follow crosses a block, and unblocking restores the peels but not the follows

-- 41. Trending: what the day is talking about, ranked on people rather than volume.
-- Its own ground: Xan, Yuki and Zoe, and tags nothing else in this file uses
-- (no other check writes a `#` at all, so what comes back is only from here).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'xan@example.com', '{"provider":"github"}', '{"user_name":"xanverify","avatar_url":""}', now(), now()),
       ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'yuki@example.com', '{"provider":"github"}', '{"user_name":"yukiverify","avatar_url":""}', now(), now()),
       ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zoe@example.com', '{"provider":"github"}', '{"user_name":"zoeverify","avatar_url":""}', now(), now());

insert into public.peels (id, title, user_id) values
  -- Two people, one tag.
  ('a1000000-0000-0000-0000-000000000001', 'rain on the roof #verifymonsoon', 'a0000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', 'the auto has a boat mode #verifymonsoon', 'a0000000-0000-0000-0000-000000000002'),
  -- One person, three peels: volume must not beat reach.
  ('a1000000-0000-0000-0000-000000000003', '#verifysolo one', 'a0000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000004', '#verifysolo two', 'a0000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000005', '#verifysolo three', 'a0000000-0000-0000-0000-000000000003'),
  -- One person, one peel, but people answered it: the tie-break among the ones.
  ('a1000000-0000-0000-0000-000000000006', 'listen to this #verifyliked', 'a0000000-0000-0000-0000-000000000001'),
  -- The same tag twice in one peel is one use of it.
  ('a1000000-0000-0000-0000-000000000007', '#verifytwice and #verifytwice again', 'a0000000-0000-0000-0000-000000000001'),
  -- Tied on everything, so only the tag itself can order them -- which is what
  -- keeps the list from reshuffling between two loads of the same page.
  ('a1000000-0000-0000-0000-000000000008', '#verifyalpha', 'a0000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000009', '#verifybeta', 'a0000000-0000-0000-0000-000000000001'),
  -- A sigil glued to a word is not a tag; same rule as lib/text.ts.
  ('a1000000-0000-0000-0000-00000000000a', 'C#verifysharp is a language', 'a0000000-0000-0000-0000-000000000001'),
  -- Outside the window.
  ('a1000000-0000-0000-0000-00000000000b', '#verifyold news', 'a0000000-0000-0000-0000-000000000001');
update public.peels set created_at = now() - interval '40 hours'
 where id = 'a1000000-0000-0000-0000-00000000000b';

-- What #verifyliked drew: two likes and a reply, i.e. a weight of three.
insert into public.likes (peel_id, user_id) values
  ('a1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003');
insert into public.peels (title, user_id, parent_id)
values ('i am listening', 'a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000006');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

do $$
declare
  ordered jsonb;
  pos jsonb;
begin
  -- row_number() over () with no sort node between it and the function call
  -- numbers the rows in the order the function returned them, which is the
  -- thing under test here.
  select jsonb_object_agg(t.tag, jsonb_build_array(t.pos, t.peels, t.people))
    into ordered
    from (select tag, peels, people, row_number() over () as pos from public.trending(24, 200)) t;
  pos := ordered;

  if pos -> 'verifymonsoon' ->> 1 <> '2' or pos -> 'verifymonsoon' ->> 2 <> '2' then
    raise exception 'check 41 FAILED: two people, two peels, counted as %', pos -> 'verifymonsoon';
  end if;
  if pos -> 'verifysolo' ->> 1 <> '3' or pos -> 'verifysolo' ->> 2 <> '1' then
    raise exception 'check 41 FAILED: three peels by one person counted as %', pos -> 'verifysolo';
  end if;
  if pos -> 'verifytwice' ->> 1 <> '1' then
    raise exception 'check 41 FAILED: the same tag twice in one peel counted twice';
  end if;
  if pos ? 'verifysharp' then
    raise exception 'check 41 FAILED: C#verifysharp was read as a hashtag';
  end if;
  if pos ? 'verifyold' then
    raise exception 'check 41 FAILED: a peel from 40 hours ago is trending today';
  end if;

  -- Reach beats volume: two people beat one person's three peels.
  if (pos -> 'verifymonsoon' ->> 0)::int >= (pos -> 'verifysolo' ->> 0)::int then
    raise exception 'check 41 FAILED: a tag one person used three times outranked a tag two people used';
  end if;
  -- Among the one-person tags, the one people answered comes first.
  if (pos -> 'verifyliked' ->> 0)::int >= (pos -> 'verifysolo' ->> 0)::int then
    raise exception 'check 41 FAILED: likes and replies did not break the tie between one-author tags';
  end if;
  -- And tags tied on all three land in an order that is the same every time.
  if not ((pos -> 'verifyalpha' ->> 0)::int < (pos -> 'verifybeta' ->> 0)::int
          and (pos -> 'verifybeta' ->> 0)::int < (pos -> 'verifytwice' ->> 0)::int) then
    raise exception 'check 41 FAILED: tags tied on every count came back in an undecided order';
  end if;
end $$;

-- A mute takes the muted person's tags out of the muter's trending, and nobody
-- else's. hidden_from() is invoker, so this is the reader's own answer.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
insert into public.mutes (muter_id, muted_id)
values ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001');
do $$
declare mine jsonb;
begin
  select jsonb_object_agg(t.tag, t.peels) into mine from public.trending(24, 200) t;
  if mine ? 'verifyliked' or mine ? 'verifytwice' then
    raise exception 'check 41 FAILED: a muted person''s tags are still trending for the muter';
  end if;
  if (mine ->> 'verifymonsoon')::int <> 1 then
    raise exception 'check 41 FAILED: the muter still counts the muted person''s peel in a shared tag';
  end if;
end $$;
delete from public.mutes where muter_id = 'a0000000-0000-0000-0000-000000000002';

-- Back as Xan, who muted nobody: the tag is two again.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare mine jsonb;
begin
  select jsonb_object_agg(t.tag, t.peels) into mine from public.trending(24, 200) t;
  if (mine ->> 'verifymonsoon')::int <> 2 then
    raise exception 'check 41 FAILED: somebody else''s mute changed what is trending for Xan';
  end if;
  -- A silly window is the default rather than an error, and a silly row count
  -- is clamped: this is a public entry point and neither may raise.
  perform public.trending(null, null);
  perform public.trending(0, 0);
  perform public.trending(100000, 100000);
end $$;
reset role;

do $$ begin
  if not has_function_privilege('anon', 'public.trending(int, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.trending(int, int)', 'execute') then
    raise exception 'check 41 FAILED: trending execute grants are wrong';
  end if;
end $$;
\echo check 41 ok: trending ranks people over volume, breaks ties the same way twice, and honours a mute

-- 42. search_peels: one function behind both tabs, and a term that stays a term.
insert into public.peels (id, title, user_id) values
  ('a2000000-0000-0000-0000-000000000001', 'a cup of #verifychai', 'a0000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000002', 'another #VerifyChai please', 'a0000000-0000-0000-0000-000000000002'),
  -- The longer tag must not answer for the shorter one.
  ('a2000000-0000-0000-0000-000000000003', 'the #verifychaiwala arrives', 'a0000000-0000-0000-0000-000000000003'),
  -- Characters that are a pattern in the wrong hands.
  ('a2000000-0000-0000-0000-000000000004', 'two stars ** and a verifypattern', 'a0000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000005', 'no stars at all, just verifypattern', 'a0000000-0000-0000-0000-000000000002'),
  -- A second pair for the other half of the weight: this one is answered rather
  -- than liked, so likes alone cannot rank it and the `+ replies` term has to.
  ('a2000000-0000-0000-0000-000000000006', 'older verifyanswered', 'a0000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000007', 'newer verifyanswered', 'a0000000-0000-0000-0000-000000000002');
-- The older of each pair carries the engagement, so Top and Latest must disagree.
update public.peels set created_at = now() - interval '3 hours'
 where id in ('a2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000006');
insert into public.likes (peel_id, user_id) values
  ('a2000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003');
insert into public.peels (title, user_id, parent_id) values
  ('answering it', 'a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000006'),
  ('answering it too', 'a0000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000006');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

do $$
declare found uuid[];
begin
  -- A hashtag term matches whole tags only.
  select array_agg(s.peel_id order by s.peel_id) into found
    from public.search_peels('#verifychai', false, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000001',
                                  'a2000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'check 42 FAILED: a hashtag search answered with %', found;
  end if;

  -- The same word without the sigil is an ordinary substring, so it reaches the
  -- longer tag too. Both spellings of the tag come back: the match is case-blind.
  if (select count(*) from public.search_peels('verifychai', false, 30)) <> 3 then
    raise exception 'check 42 FAILED: a plain term did not match every peel containing it';
  end if;

  -- `**` is a regex, a LIKE pattern and a PostgREST rewrite all at once; here it
  -- is two asterisks and nothing else.
  select array_agg(s.peel_id) into found from public.search_peels('**', false, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000004']::uuid[] then
    raise exception 'check 42 FAILED: `**` was treated as a pattern, answering %', found;
  end if;

  -- Nothing searched for is nothing found, not everything found.
  if (select count(*) from public.search_peels('', false, 30)) <> 0
     or (select count(*) from public.search_peels(null, false, 30)) <> 0 then
    raise exception 'check 42 FAILED: an empty term matched peels';
  end if;

  -- Latest is newest first; Top is what people answered, which here is the
  -- older of the two. The two tabs must not agree, or one of them is not doing
  -- its job.
  select array_agg(s.peel_id) into found from public.search_peels('verifypattern', false, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000005',
                                  'a2000000-0000-0000-0000-000000000004']::uuid[] then
    raise exception 'check 42 FAILED: Latest is not newest first, it answered %', found;
  end if;
  select array_agg(s.peel_id) into found from public.search_peels('verifypattern', true, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000004',
                                  'a2000000-0000-0000-0000-000000000005']::uuid[] then
    raise exception 'check 42 FAILED: Top did not rank on likes, it answered %', found;
  end if;

  -- The same again where the winner was answered rather than liked, so both
  -- halves of the weight are load-bearing and neither can quietly drop out.
  select array_agg(s.peel_id) into found from public.search_peels('verifyanswered', false, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000007',
                                  'a2000000-0000-0000-0000-000000000006']::uuid[] then
    raise exception 'check 42 FAILED: Latest is not newest first, it answered %', found;
  end if;
  select array_agg(s.peel_id) into found from public.search_peels('verifyanswered', true, 30) s;
  if found is distinct from array['a2000000-0000-0000-0000-000000000006',
                                  'a2000000-0000-0000-0000-000000000007']::uuid[] then
    raise exception 'check 42 FAILED: Top did not rank on replies, it answered %', found;
  end if;

  -- The row count is the caller's, within bounds, and never an error.
  if (select count(*) from public.search_peels('verifychai', false, 1)) <> 1 then
    raise exception 'check 42 FAILED: max_rows was ignored';
  end if;
  perform public.search_peels('verifychai', null, null);
  perform public.search_peels('verifychai', true, 100000);
end $$;

-- A muted author drops out of the results, and only for the person who muted
-- them: this is the filter the app used to do afterwards, done where the page
-- size is decided.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
insert into public.mutes (muter_id, muted_id)
values ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001');
do $$ begin
  if exists (select 1 from public.search_peels('verifychai', false, 30) s
              where s.peel_id = 'a2000000-0000-0000-0000-000000000001') then
    raise exception 'check 42 FAILED: a muted person''s peel is still in the results';
  end if;
  if not exists (select 1 from public.search_peels('verifychai', false, 30) s
                  where s.peel_id = 'a2000000-0000-0000-0000-000000000002') then
    raise exception 'check 42 FAILED: a mute took somebody else''s peel with it';
  end if;
end $$;
delete from public.mutes where muter_id = 'a0000000-0000-0000-0000-000000000003';
reset role;

do $$ begin
  if not has_function_privilege('anon', 'public.search_peels(text, boolean, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.search_peels(text, boolean, int)', 'execute') then
    raise exception 'check 42 FAILED: search_peels execute grants are wrong';
  end if;
end $$;
\echo check 42 ok: one search behind both tabs, terms stay literal, tags match whole, mutes drop out

--------------------------------------------------------------------------------
-- 43. Link previews: readable by everyone signed in, writable once, and never
--     rewritable -- which is what makes a row nobody can be sure of harmless.
--------------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_class where oid = 'public.link_previews'::regclass and relrowsecurity) then
    raise exception 'check 43 FAILED: RLS is not on for link_previews';
  end if;
  -- anon reads peels now, so it has cards to draw: SELECT and nothing else.
  -- A row nobody can be sure of is one a signed-out visitor must not write.
  if not has_table_privilege('anon', 'public.link_previews', 'select')
     or has_table_privilege('anon', 'public.link_previews', 'insert')
     or has_table_privilege('anon', 'public.link_previews', 'update')
     or has_table_privilege('anon', 'public.link_previews', 'delete') then
    raise exception 'check 43 FAILED: anon privileges on link_previews are wrong';
  end if;
  if not has_table_privilege('authenticated', 'public.link_previews', 'select')
     or not has_table_privilege('authenticated', 'public.link_previews', 'insert') then
    raise exception 'check 43 FAILED: a signed-in reader cannot read or record a preview';
  end if;
  -- The whole trust argument rests on this half: the row cannot be changed
  -- after it is written, so the first fetch of a url is the one everybody sees.
  if has_table_privilege('authenticated', 'public.link_previews', 'update')
     or has_table_privilege('authenticated', 'public.link_previews', 'delete') then
    raise exception 'check 43 FAILED: a signed-in person can rewrite or remove a link preview';
  end if;
end $$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

insert into public.link_previews (url, title, description, image_url)
values ('https://ada.dev/notes', 'Ada''s notes', 'Mostly citrus.', 'https://ada.dev/card.png');
-- A page that gave up nothing still earns its row, or every peel that mentions
-- it goes and knocks on it again.
insert into public.link_previews (url) values ('https://ada.dev/bare');
-- The loopback exception, which is how the e2e suite previews a page it serves.
insert into public.link_previews (url, title) values ('http://127.0.0.1:3211/og', 'served by the suite');

do $$ begin
  if (select title from public.link_previews where url = 'https://ada.dev/notes') <> 'Ada''s notes' then
    raise exception 'check 43 FAILED: the row that was written is not the row that reads back';
  end if;
  if (select count(*) from public.link_previews where url = 'https://ada.dev/bare' and title is null) <> 1 then
    raise exception 'check 43 FAILED: a page with no tags did not get its row';
  end if;
end $$;

-- Insert-once: the same url again collides rather than overwriting, and neither
-- an update nor a delete is open to anybody.
do $$ begin
  insert into public.link_previews (url, title) values ('https://ada.dev/notes', 'not what the page says');
  raise exception 'check 43 FAILED: a second row for the same url went in';
exception when unique_violation then null; end $$;
do $$ begin
  update public.link_previews set title = 'rewritten' where url = 'https://ada.dev/notes';
  raise exception 'check 43 FAILED: a link preview was rewritten';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.link_previews where url = 'https://ada.dev/notes';
  raise exception 'check 43 FAILED: a link preview was deleted';
exception when insufficient_privilege then null; end $$;

-- The url and the picture are the two fields that become attributes in somebody
-- else's browser, so the scheme is the database's business and not only the app's.
do $$ begin
  insert into public.link_previews (url) values ('http://evil.example/x');
  raise exception 'check 43 FAILED: a plain http url was stored';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.link_previews (url) values ('javascript:alert(1)');
  raise exception 'check 43 FAILED: a javascript: url was stored';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.link_previews (url, image_url) values ('https://ada.dev/a', 'javascript:alert(1)');
  raise exception 'check 43 FAILED: a javascript: picture was stored';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.link_previews (url, image_url) values ('https://ada.dev/b', 'http://evil.example/pixel.gif');
  raise exception 'check 43 FAILED: a plain http picture was stored';
exception when check_violation then null; end $$;

-- The lengths the card is drawn to. An empty string is not a title.
do $$ begin
  insert into public.link_previews (url, title) values ('https://ada.dev/c', repeat('x', 201));
  raise exception 'check 43 FAILED: a title over 200 characters was stored';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.link_previews (url, title) values ('https://ada.dev/d', '');
  raise exception 'check 43 FAILED: an empty title was stored';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.link_previews (url, description) values ('https://ada.dev/e', repeat('x', 401));
  raise exception 'check 43 FAILED: a description over 400 characters was stored';
exception when check_violation then null; end $$;

-- One fetch serves everybody: the next person signed in reads the same row.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if (select count(*) from public.link_previews where url = 'https://ada.dev/notes') <> 1 then
    raise exception 'check 43 FAILED: a preview somebody else fetched is invisible';
  end if;
end $$;
reset role;
\echo check 43 ok: link previews are shared, written once, and never rewritten

--------------------------------------------------------------------------------
-- 44. add_thread: a chain that posts whole or not at all.
--------------------------------------------------------------------------------

-- Its own ground: two people and two peels nothing else in this file touches.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'thready@example.com', '{"provider":"github"}', '{"user_name":"threadyverify","avatar_url":""}', now(), now()),
       ('a4000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'blocky@example.com', '{"provider":"github"}', '{"user_name":"blockyverify","avatar_url":""}', now(), now());

insert into public.peels (id, title, user_id) values
  ('a5000000-0000-0000-0000-000000000001', 'the peel a thread answers', 'a4000000-0000-0000-0000-000000000002'),
  ('a5000000-0000-0000-0000-000000000002', 'the peel a thread quotes', 'a4000000-0000-0000-0000-000000000002');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

-- The shape of the thing: three peels, the first answering a peel and quoting
-- another, each one after it a reply to the one before, pictures where they were
-- put and nowhere else.
do $$
declare
  made uuid[];
  p public.peels%rowtype;
begin
  made := public.add_thread(
    jsonb_build_array(
      jsonb_build_object('title', 'verifythread one',
                         'media', jsonb_build_array(
                           jsonb_build_object('kind', 'image', 'url', 'https://ada.dev/a.png',
                                              'alt', 'first', 'width', 10, 'height', 20),
                           jsonb_build_object('kind', 'image', 'url', 'https://ada.dev/b.png', 'alt', 'second'))),
      jsonb_build_object('title', 'verifythread two, and @blockyverify is in it'),
      -- A missing key and an explicit json null both mean "nothing attached".
      jsonb_build_object('title', 'verifythread three', 'media', null)),
    'a5000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000002');

  if cardinality(made) <> 3 then
    raise exception 'check 44 FAILED: a thread of three made % peels', cardinality(made);
  end if;

  select * into strict p from public.peels where id = made[1];
  if p.parent_id is distinct from 'a5000000-0000-0000-0000-000000000001'::uuid
     or p.quote_id is distinct from 'a5000000-0000-0000-0000-000000000002'::uuid
     or p.user_id <> 'a4000000-0000-0000-0000-000000000001'
     or p.title <> 'verifythread one' then
    raise exception 'check 44 FAILED: the first peel of the thread is %', p;
  end if;

  select * into strict p from public.peels where id = made[2];
  if p.parent_id is distinct from made[1] then
    raise exception 'check 44 FAILED: the second peel is not a reply to the first, it hangs off %', p.parent_id;
  end if;
  -- A quote embeds one peel; repeating the card down the chain is not a thread.
  if p.quote_id is not null then
    raise exception 'check 44 FAILED: the quote was repeated on the second peel';
  end if;

  select * into strict p from public.peels where id = made[3];
  if p.parent_id is distinct from made[2] or p.title <> 'verifythread three' then
    raise exception 'check 44 FAILED: the third peel is %', p;
  end if;

  if (select count(*) from public.peel_media m where m.peel_id = made[1]) <> 2
     or (select count(*) from public.peel_media m where m.peel_id = made[2]) <> 0
     or (select count(*) from public.peel_media m where m.peel_id = made[3]) <> 0 then
    raise exception 'check 44 FAILED: the pictures did not stay on the peel they were attached to';
  end if;
  -- `is distinct from` rather than `<>`: a row that moved leaves the subquery
  -- empty, and `null <> 'x'` is null, which an `if` treats as "fine".
  if (select m.url from public.peel_media m where m.peel_id = made[1] and m.position = 0)
       is distinct from 'https://ada.dev/a.png'
     or (select m.alt from public.peel_media m where m.peel_id = made[1] and m.position = 1)
       is distinct from 'second' then
    raise exception 'check 44 FAILED: media position does not follow the order of the array';
  end if;
  if (select m.width from public.peel_media m where m.peel_id = made[1] and m.position = 0) is distinct from 10
     or (select m.height from public.peel_media m where m.peel_id = made[1] and m.position = 1) is not null then
    raise exception 'check 44 FAILED: media dimensions did not come through as given';
  end if;
end $$;

-- The notify trigger is per row, so it fires for every peel in the chain and not
-- only the one that started it. Read as the owner: a notification is the
-- recipient's to see, and the recipient is not the person posting.
reset role;
do $$ begin
  if not exists (select 1 from public.notifications n
                  join public.peels p on p.id = n.peel_id
                  where n.user_id = 'a4000000-0000-0000-0000-000000000002'
                    and n.type = 'mention' and p.title like 'verifythread two%') then
    raise exception 'check 44 FAILED: a mention in the middle of a thread did not ring';
  end if;
  if (select count(*) from public.notifications n
       where n.user_id = 'a4000000-0000-0000-0000-000000000002' and n.type = 'reply') <> 1 then
    raise exception 'check 44 FAILED: the thread rang % reply bells rather than one',
      (select count(*) from public.notifications n
        where n.user_id = 'a4000000-0000-0000-0000-000000000002' and n.type = 'reply');
  end if;
end $$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;

-- Whole or nothing. This is the entire reason the chain is a function rather
-- than a loop in the server action: the peels before the bad one must not exist
-- afterwards, and no amount of tidying up in the app can promise that.
do $$
declare before_count int;
begin
  select count(*) into before_count from public.peels p where p.user_id = 'a4000000-0000-0000-0000-000000000001';

  begin
    perform public.add_thread(jsonb_build_array(
      jsonb_build_object('title', 'verifyatomic one'),
      jsonb_build_object('title', 'verifyatomic two'),
      jsonb_build_object('title', repeat('x', 281))));
    raise exception 'check 44 FAILED: a thread with an over-long peel in it posted';
  exception when check_violation then null; end;

  -- A picture is the other half of an item, and it fails the same way.
  begin
    perform public.add_thread(jsonb_build_array(
      jsonb_build_object('title', 'verifyatomic three'),
      jsonb_build_object('title', 'verifyatomic four',
                         'media', jsonb_build_array(
                           jsonb_build_object('kind', 'image', 'url', 'http://evil.example/x.png', 'alt', 'no')))));
    raise exception 'check 44 FAILED: a thread carrying an unstorable picture posted';
  exception when check_violation then null; end;

  if (select count(*) from public.peels p where p.user_id = 'a4000000-0000-0000-0000-000000000001') <> before_count then
    raise exception 'check 44 FAILED: a failed thread left peels behind';
  end if;
  if exists (select 1 from public.peels p where p.title like 'verifyatomic%') then
    raise exception 'check 44 FAILED: the peels before the failure are still there';
  end if;
end $$;

-- The bounds, and the length that is meant to work. 25 is peel_ancestors()'s
-- depth, so the last peel of the longest thread can still draw its whole chain.
do $$ begin
  perform public.add_thread('[]'::jsonb);
  raise exception 'check 44 FAILED: an empty thread posted';
exception when invalid_parameter_value then null; end $$;
do $$ begin
  perform public.add_thread('"not an array"'::jsonb);
  raise exception 'check 44 FAILED: something that is not an array of peels posted';
exception when invalid_parameter_value then null; end $$;
do $$ begin
  perform public.add_thread((select jsonb_agg(jsonb_build_object('title', 'verifyover ' || n) order by n)
                               from generate_series(1, 26) n));
  raise exception 'check 44 FAILED: a 26-peel thread posted';
exception when invalid_parameter_value then null; end $$;
do $$
declare made uuid[];
begin
  made := public.add_thread((select jsonb_agg(jsonb_build_object('title', 'verifylong ' || n) order by n)
                               from generate_series(1, 25) n));
  if cardinality(made) <> 25 then
    raise exception 'check 44 FAILED: 25 peels is meant to be allowed, % came back', cardinality(made);
  end if;
  if (select p.parent_id from public.peels p where p.id = made[25]) is distinct from made[24] then
    raise exception 'check 44 FAILED: the chain broke somewhere before the 25th peel';
  end if;
end $$;

-- Not a way past anything: the peels insert policy still runs, so a thread
-- cannot answer somebody who has blocked you.
reset role;
insert into public.blocks (blocker_id, blocked_id)
values ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$ begin
  perform public.add_thread(jsonb_build_array(jsonb_build_object('title', 'verifyblocked one')),
                            'a5000000-0000-0000-0000-000000000001');
  raise exception 'check 44 FAILED: a blocked person threaded a reply into the person who blocked them';
exception when insufficient_privilege then null; end $$;
reset role;
delete from public.blocks where blocker_id = 'a4000000-0000-0000-0000-000000000002';

do $$ begin
  if has_function_privilege('anon', 'public.add_thread(jsonb, uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.add_thread(jsonb, uuid, uuid)', 'execute') then
    raise exception 'check 44 FAILED: add_thread execute grants are wrong';
  end if;
  -- Invoker is what keeps every rule above in force. Definer would make this
  -- function the one way to post that RLS never sees.
  if (select p.prosecdef from pg_proc p where p.oid = 'public.add_thread(jsonb, uuid, uuid)'::regprocedure) then
    raise exception 'check 44 FAILED: add_thread is security definer';
  end if;
end $$;
\echo check 44 ok: a thread posts as one chain, whole or not at all


-- Messages, checks 45-50.
--
-- Note for everything below: verify.sql is ONE transaction, so now() is the same
-- value in every statement of it. Any assertion of the form "this did not move"
-- has to give the column a stamp from another year first, or it passes against
-- code that moved it -- which is a check that cannot fail.

-- 45. The shape: the pair is ordered and unique, both derived member columns
--     have to name a member, and a body is 1..2000 characters.
-- Its own ground: three accounts no earlier check has touched.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'fern@example.com', '{"provider":"github"}', '{"user_name":"fernverify","avatar_url":""}', now(), now()),
       ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'gus@example.com', '{"provider":"github"}', '{"user_name":"gusverify","avatar_url":""}', now(), now()),
       ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'hana@example.com', '{"provider":"github"}', '{"user_name":"hanaverify","avatar_url":""}', now(), now());

-- fern < gus < hana as uuids, which is what makes `a` fern in every pair below.
do $$ begin
  if not ('b0000000-0000-0000-0000-000000000001'::uuid < 'b0000000-0000-0000-0000-000000000002'::uuid
          and 'b0000000-0000-0000-0000-000000000002'::uuid < 'b0000000-0000-0000-0000-000000000003'::uuid) then
    raise exception 'check 45 FAILED: the fixtures are not in the order the rest of this check assumes';
  end if;
end $$;

do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
  raise exception 'check 45 FAILED: an out-of-order pair was accepted';
exception when check_violation then null; end $$;

insert into public.conversations (id, a, b, started_by, last_sender_id)
values ('b1000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');

do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
          'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
  raise exception 'check 45 FAILED: a second conversation for the same pair was accepted';
exception when unique_violation then null; end $$;

do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
          'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001');
  raise exception 'check 45 FAILED: a conversation started by somebody who is not in it was accepted';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
          'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
  raise exception 'check 45 FAILED: a last sender who is not in the conversation was accepted';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id, last_preview)
  values ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
          'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', repeat('x', 141));
  raise exception 'check 45 FAILED: a 141-character preview was accepted';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.messages (conversation_id, sender_id, body)
  values ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '');
  raise exception 'check 45 FAILED: an empty message was accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.messages (conversation_id, sender_id, body)
  values ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', repeat('x', 2001));
  raise exception 'check 45 FAILED: a 2001-character message was accepted';
exception when check_violation then null; end $$;

-- The longest message that is meant to work, with a stamp from another year:
-- the conversation must take ITS time, not the time of the write.
insert into public.messages (conversation_id, sender_id, body, created_at)
values ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', repeat('x', 2000),
        '2031-03-04 05:06:07+00');
do $$
declare c public.conversations%rowtype;
begin
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000001';
  if c.last_message_at <> '2031-03-04 05:06:07+00'::timestamptz then
    raise exception 'check 45 FAILED: the conversation is stamped %, not with its message''s own time', c.last_message_at;
  end if;
  if c.last_preview <> repeat('x', 140) then
    raise exception 'check 45 FAILED: the preview is % characters, not 140', char_length(c.last_preview);
  end if;
end $$;
\echo check 45 ok: one ordered conversation per pair, members named, body 1..2000

-- 46. send_message(): makes the conversation the first time and reuses it after,
--     lands as a request unless they already follow you, refuses to talk to
--     yourself, and is refused between two people a block separates.
-- Its own ground: four fresh accounts, since the check counts conversations.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('b0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'jo@example.com', '{"provider":"github"}', '{"user_name":"joverify","avatar_url":""}', now(), now()),
       ('b0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'kai@example.com', '{"provider":"github"}', '{"user_name":"kaiverify","avatar_url":""}', now(), now()),
       ('b0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'lee@example.com', '{"provider":"github"}', '{"user_name":"leeverify","avatar_url":""}', now(), now()),
       ('b0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'mira@example.com', '{"provider":"github"}', '{"user_name":"miraverify","avatar_url":""}', now(), now());
-- lee follows jo; kai and mira have never heard of him.
insert into public.follows (follower_id, followee_id)
values ('b0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000011');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
end $$;

do $$
declare wrote public.messages; c public.conversations%rowtype;
begin
  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000012', 'first words') s;
  if wrote.sender_id <> 'b0000000-0000-0000-0000-000000000011' or wrote.body <> 'first words' then
    raise exception 'check 46 FAILED: send_message returned the wrong message: %', wrote;
  end if;
  select * into strict c from public.conversations where id = wrote.conversation_id;
  if c.started_by <> 'b0000000-0000-0000-0000-000000000011' then
    raise exception 'check 46 FAILED: the conversation was not started by the sender';
  end if;
  -- kai does not follow jo, so this is a request.
  if c.accepted_at is not null then
    raise exception 'check 46 FAILED: a message from somebody they do not follow was accepted on the spot';
  end if;
  if c.last_preview <> 'first words' or c.last_sender_id <> 'b0000000-0000-0000-0000-000000000011' then
    raise exception 'check 46 FAILED: the conversation does not carry the message it was made by: %', c;
  end if;
end $$;

-- Sending again reuses the conversation rather than making a second one.
do $$
declare wrote public.messages; n int;
begin
  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000012', 'and more') s;
  select count(*) into n from public.conversations c
   where c.a = 'b0000000-0000-0000-0000-000000000011' and c.b = 'b0000000-0000-0000-0000-000000000012';
  if n <> 1 then
    raise exception 'check 46 FAILED: expected one conversation for the pair, found %', n;
  end if;
  if (select count(*) from public.messages m where m.conversation_id = wrote.conversation_id) <> 2 then
    raise exception 'check 46 FAILED: the second message did not land in the same conversation';
  end if;
end $$;

-- lee follows jo, so jo's first message to lee is not a request.
do $$
declare wrote public.messages;
begin
  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000013', 'hello you') s;
  if (select c.accepted_at from public.conversations c where c.id = wrote.conversation_id) is null then
    raise exception 'check 46 FAILED: a message to somebody who follows you was left waiting in requests';
  end if;
end $$;

do $$ begin
  perform public.send_message('b0000000-0000-0000-0000-000000000011', 'talking to myself');
  raise exception 'check 46 FAILED: a message to yourself was accepted';
exception when invalid_parameter_value then null; end $$;

-- The conversation insert policy is the wall a crafted request hits, and
-- send_message being invoker is what puts it in the way. By hand, as jo:
-- a conversation that arrives already accepted by somebody who does not follow
-- him would walk straight past Requests...
do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id, accepted_at)
  values ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000014',
          'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000011', now());
  raise exception 'check 46 FAILED: a conversation let itself in already accepted';
exception when insufficient_privilege then null; end $$;
-- ...and one stamped with somebody else's name would show in their list as a
-- conversation they started.
do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000014',
          'b0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000014');
  raise exception 'check 46 FAILED: a conversation was started in somebody else''s name';
exception when insufficient_privilege then null; end $$;

-- A block refuses the conversation before it exists...
reset role;
insert into public.blocks (blocker_id, blocked_id)
values ('b0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000011'),
       ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000011');
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
end $$;
do $$ begin
  perform public.send_message('b0000000-0000-0000-0000-000000000014', 'let me in');
  raise exception 'check 46 FAILED: somebody who blocked you can still be written to';
exception when insufficient_privilege then null; end $$;
-- The same wall on the conversation itself, and not only on the words. The
-- message insert would refuse the body either way, but without the block clause
-- on THIS policy a crafted request still leaves an empty conversation sitting in
-- the inbox of the person who blocked them.
do $$ begin
  insert into public.conversations (a, b, started_by, last_sender_id)
  values ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000014',
          'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000011');
  raise exception 'check 46 FAILED: a blocked person opened a conversation with the person who blocked them';
exception when insufficient_privilege then null; end $$;
-- ...and inside one that already exists.
do $$ begin
  perform public.send_message('b0000000-0000-0000-0000-000000000012', 'still here');
  raise exception 'check 46 FAILED: a block does not stop a message into a conversation that predates it';
exception when insufficient_privilege then null; end $$;
reset role;
delete from public.blocks
 where blocker_id in ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000014');
\echo check 46 ok: send_message makes one conversation, requests where it should, and obeys a block

-- 47. Answering a request is what accepts it -- and an accepted conversation
--     never goes back to being one.
-- Ground: the jo -> kai request from check 46, still pending, its block lifted.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000012', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
end $$;
do $$
declare c public.conversations%rowtype; wrote public.messages;
begin
  select * into strict c from public.conversations
   where a = 'b0000000-0000-0000-0000-000000000011' and b = 'b0000000-0000-0000-0000-000000000012';
  if c.accepted_at is not null then
    raise exception 'check 47 FAILED: this check needs a pending request as its ground';
  end if;

  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000011', 'go on then') s;
  select * into strict c from public.conversations where id = wrote.conversation_id;
  if c.accepted_at is null then
    raise exception 'check 47 FAILED: answering a request did not accept it';
  end if;
  if c.last_sender_id <> 'b0000000-0000-0000-0000-000000000012' then
    raise exception 'check 47 FAILED: the last sender did not move to the person who replied';
  end if;
end $$;

-- Stamp the acceptance with a time that is not now(), so "it did not move" is a
-- thing this transaction can actually see.
reset role;
update public.conversations set accepted_at = '2020-02-02 00:00:00+00'
 where a = 'b0000000-0000-0000-0000-000000000011' and b = 'b0000000-0000-0000-0000-000000000012';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
end $$;
do $$
declare wrote public.messages; c public.conversations%rowtype;
begin
  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000012', 'thanks') s;
  select * into strict c from public.conversations where id = wrote.conversation_id;
  if c.accepted_at <> '2020-02-02 00:00:00+00'::timestamptz then
    raise exception 'check 47 FAILED: another message re-stamped an acceptance that was already made';
  end if;
  if c.last_preview <> 'thanks' then
    raise exception 'check 47 FAILED: the preview did not follow the newest message';
  end if;
end $$;
reset role;
\echo check 47 ok: answering a request accepts it, once and once only

-- 48. Following somebody accepts the request they had sent you.
-- Ground: mira has never heard of lee; lee writes to her, then she follows him.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
end $$;
do $$
declare wrote public.messages;
begin
  select * into strict wrote from public.send_message('b0000000-0000-0000-0000-000000000014', 'do you remember me') s;
  if (select c.accepted_at from public.conversations c where c.id = wrote.conversation_id) is not null then
    raise exception 'check 48 FAILED: this check needs a pending request as its ground';
  end if;
end $$;
-- The follow is mira's to make, so it is made as her.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000014', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000014","role":"authenticated"}', true);
end $$;
insert into public.follows (follower_id, followee_id)
values ('b0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000013');
do $$
declare c public.conversations%rowtype;
begin
  select * into strict c from public.conversations
   where a = 'b0000000-0000-0000-0000-000000000013' and b = 'b0000000-0000-0000-0000-000000000014';
  if c.accepted_at is null then
    raise exception 'check 48 FAILED: following somebody left their request to you waiting';
  end if;
end $$;
-- It accepts THEIR request, not one pointing the other way: jo's request to kai
-- was accepted by an answer in check 47, and nothing here may have touched the
-- one lee still has out to nobody. Mira following lee says nothing about the
-- request mira herself might have sent somebody else.
reset role;
\echo check 48 ok: following somebody accepts the request they sent you

-- 49. mark_read() and accept_conversation(): your own side, your own answer.
-- Ground of its own: two conversations written here, with stamps from 2020 so
-- "this side did not move" is visible inside one transaction.
insert into public.conversations (id, a, b, started_by, last_sender_id, a_read_at, b_read_at)
values ('b1000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003',
        '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00');

set local role authenticated;
-- fern is `a`. Marking read must stamp a_read_at and leave b_read_at in 2020.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare c public.conversations%rowtype;
begin
  perform public.mark_read('b1000000-0000-0000-0000-000000000002');
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000002';
  if c.a_read_at = '2020-01-01 00:00:00+00'::timestamptz then
    raise exception 'check 49 FAILED: marking read did not stamp the caller''s own side';
  end if;
  if c.b_read_at <> '2020-01-01 00:00:00+00'::timestamptz then
    raise exception 'check 49 FAILED: marking read stamped the other person''s side too';
  end if;
end $$;

-- hana is `b`, and gets the mirror image.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
do $$
declare c public.conversations%rowtype;
begin
  perform public.mark_read('b1000000-0000-0000-0000-000000000002');
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000002';
  if c.b_read_at = '2020-01-01 00:00:00+00'::timestamptz then
    raise exception 'check 49 FAILED: the `b` side cannot mark its own conversation read';
  end if;
end $$;

-- Accepting: hana started this one, so it is not hers to accept.
do $$
declare c public.conversations%rowtype;
begin
  perform public.accept_conversation('b1000000-0000-0000-0000-000000000002');
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000002';
  if c.accepted_at is not null then
    raise exception 'check 49 FAILED: the person who sent a request accepted it themselves';
  end if;
end $$;
-- fern's, though.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
do $$
declare c public.conversations%rowtype;
begin
  perform public.accept_conversation('b1000000-0000-0000-0000-000000000002');
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000002';
  if c.accepted_at is null then
    raise exception 'check 49 FAILED: the person a request was sent to could not accept it';
  end if;
end $$;
-- And an acceptance that already happened is not re-stamped by calling again.
reset role;
update public.conversations set accepted_at = '2020-03-03 00:00:00+00'
 where id = 'b1000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$
declare c public.conversations%rowtype;
begin
  perform public.accept_conversation('b1000000-0000-0000-0000-000000000002');
  select * into strict c from public.conversations where id = 'b1000000-0000-0000-0000-000000000002';
  if c.accepted_at <> '2020-03-03 00:00:00+00'::timestamptz then
    raise exception 'check 49 FAILED: accepting twice moved the acceptance';
  end if;
end $$;
reset role;
\echo check 49 ok: you mark your own side read, and only the recipient accepts a request

-- 50. Messages are private: a third party reads neither side of a conversation,
--     only the person a request was sent to can bin it, and nobody may edit or
--     unsend anything.
-- Ground of its own: a pending request gus -> hana with a message in it, and an
-- accepted conversation between jo and mira.
insert into public.conversations (id, a, b, started_by, last_sender_id, accepted_at)
values ('b1000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', null),
       ('b1000000-0000-0000-0000-000000000004',
        'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000014',
        'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000011', now());
insert into public.messages (id, conversation_id, sender_id, body)
values ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000002', 'unwanted');

set local role authenticated;
-- lee is in neither conversation.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
end $$;
do $$ begin
  if exists (select 1 from public.conversations c where c.id = 'b1000000-0000-0000-0000-000000000003') then
    raise exception 'check 50 FAILED: a third party can see somebody else''s conversation';
  end if;
  if exists (select 1 from public.messages m where m.id = 'b2000000-0000-0000-0000-000000000001') then
    raise exception 'check 50 FAILED: a third party can read somebody else''s messages';
  end if;
  -- Nor can he bin it.
  delete from public.conversations where id = 'b1000000-0000-0000-0000-000000000003';
end $$;

-- The two people in it can read it.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
end $$;
do $$ begin
  if not exists (select 1 from public.messages m where m.id = 'b2000000-0000-0000-0000-000000000001') then
    raise exception 'check 50 FAILED: somebody cannot read a message in their own conversation';
  end if;
  -- gus sent this request, so it is not his to take back out of hana's inbox.
  delete from public.conversations where id = 'b1000000-0000-0000-0000-000000000003';
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.conversations where id = 'b1000000-0000-0000-0000-000000000003') then
    raise exception 'check 50 FAILED: a request was binned by somebody it was not sent to';
  end if;
end $$;

-- An accepted conversation is not binnable either, by either of them.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000014', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000014","role":"authenticated"}', true);
end $$;
delete from public.conversations where id = 'b1000000-0000-0000-0000-000000000004';
reset role;
do $$ begin
  if not exists (select 1 from public.conversations where id = 'b1000000-0000-0000-0000-000000000004') then
    raise exception 'check 50 FAILED: an accepted conversation was deleted';
  end if;
end $$;

-- The person it was sent to bins it, and its messages go with it.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
delete from public.conversations where id = 'b1000000-0000-0000-0000-000000000003';
reset role;
do $$ begin
  if exists (select 1 from public.conversations where id = 'b1000000-0000-0000-0000-000000000003') then
    raise exception 'check 50 FAILED: a request could not be binned by the person it was sent to';
  end if;
  if exists (select 1 from public.messages m where m.id = 'b2000000-0000-0000-0000-000000000001') then
    raise exception 'check 50 FAILED: binning a request left its messages behind';
  end if;
end $$;

do $$ begin
  -- Nobody edits or unsends a message, and nobody writes the derived columns by
  -- hand: no update grant on either table, and no delete on messages.
  if has_table_privilege('authenticated', 'public.conversations', 'update')
     or has_table_privilege('authenticated', 'public.messages', 'update')
     or has_table_privilege('authenticated', 'public.messages', 'delete') then
    raise exception 'check 50 FAILED: authenticated can rewrite a conversation or a message';
  end if;
  if has_table_privilege('anon', 'public.conversations', 'select')
     or has_table_privilege('anon', 'public.messages', 'select') then
    raise exception 'check 50 FAILED: anon can read messages';
  end if;

  -- The open conversation, the list and the badge all hang off this.
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    raise exception 'check 50 FAILED: public.messages not in supabase_realtime';
  end if;

  -- send_message is invoker: the two insert policies are what stop a blocked
  -- sender, and definer would put this function past both of them.
  if (select p.prosecdef from pg_proc p where p.oid = 'public.send_message(uuid, text)'::regprocedure) then
    raise exception 'check 50 FAILED: send_message is security definer';
  end if;
  -- These three write columns nobody holds UPDATE on, so they have to be.
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.mark_read(uuid)'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.accept_conversation(uuid)'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.bump_conversation()'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.accept_on_follow()'::regprocedure) then
    raise exception 'check 50 FAILED: a function that writes the derived columns is not security definer';
  end if;
  if has_function_privilege('anon', 'public.send_message(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.mark_read(uuid)', 'execute')
     or has_function_privilege('anon', 'public.accept_conversation(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.send_message(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_read(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.accept_conversation(uuid)', 'execute') then
    raise exception 'check 50 FAILED: the message function execute grants are wrong';
  end if;
end $$;
\echo check 50 ok: a conversation is readable by its two people and nobody else


--------------------------------------------------------------------------------
-- 51. The square is public. A signed-out visitor reads the same peels, the same
--     timeline, the same trending list, the same search and the same thread
--     walk a signed-in one does -- and still reaches nothing that is between
--     two people or private to one, and writes nothing at all.
--------------------------------------------------------------------------------

-- Its own ground: four accounts no earlier check has touched.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ida@example.com', '{"provider":"github"}', '{"user_name":"idaverify","avatar_url":""}', now(), now()),
       ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ned@example.com', '{"provider":"github"}', '{"user_name":"nedverify","avatar_url":""}', now(), now()),
       ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'orla@example.com', '{"provider":"github"}', '{"user_name":"orlaverify","avatar_url":""}', now(), now()),
       ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'pip@example.com', '{"provider":"github"}', '{"user_name":"pipverify","avatar_url":""}', now(), now());

-- One of everything the four read functions and the app's embed literal touch:
-- a tagged peel, a reply under it, a repeel of it, a bookmark of it, and a
-- second author's peel to prove a block does not reach a stranger.
insert into public.peels (id, title, user_id) values
  ('c1000000-0000-0000-0000-000000000001', 'the gates are open #verifysquare', 'c0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000003', 'pip, saying hello to nobody in particular', 'c0000000-0000-0000-0000-000000000004');
insert into public.peels (id, title, user_id, parent_id) values
  ('c1000000-0000-0000-0000-000000000002', 'a reply under the open gate', 'c0000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000001');
insert into public.reposts (user_id, peel_id)
  values ('c0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001');
insert into public.bookmarks (user_id, peel_id)
  values ('c0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001');
-- orla mutes pip, and ida blocks pip. Both must survive the square opening, and
-- neither is any of a signed-out reader's business.
insert into public.mutes (muter_id, muted_id)
  values ('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004');
insert into public.blocks (blocker_id, blocked_id)
  values ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004');

-- The two totals the signed-out reader is measured against. They are carried in
-- settings rather than a plpgsql variable because nothing declared in one block
-- survives into the next, and these have to cross a role change.
do $$ begin
  perform set_config('verify.peels_total', (select count(*)::text from public.peels), true);
  perform set_config('verify.bookmarks_total', (select count(*)::text from public.bookmarks), true);
  if (select count(*) from public.bookmarks) = 0 then
    raise exception 'check 51 FAILED: no bookmark left to keep private';
  end if;
end $$;

set local role anon;
-- A real signed-out request carries the anon key and no `sub`, so auth.uid() is
-- null. The claims the last authenticated block left behind are not that.
do $$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
do $$
declare n int; peels_seen int; reposts_seen int;
begin
  -- Every peel, and the same set the owner of the table sees: an anon policy
  -- that quietly dropped replies, or one author, would show up here.
  select count(*) into n from public.peels;
  if n <> current_setting('verify.peels_total')::int then
    raise exception 'check 51 FAILED: a signed-out reader sees % peels of %', n, current_setting('verify.peels_total');
  end if;

  -- The timeline, with both kinds of row on it: a peel, and somebody's repeel.
  select count(*) filter (where t.repost_by is null),
         count(*) filter (where t.repost_by is not null)
    into peels_seen, reposts_seen
    from public.home_timeline(false, null, 50) t;
  if peels_seen = 0 or reposts_seen = 0 then
    raise exception 'check 51 FAILED: the signed-out timeline had % peels and % repeels', peels_seen, reposts_seen;
  end if;

  -- Trending, search and the thread walk all answer rather than raise, which is
  -- what hidden_from(null, ...) returning false without naming a table buys.
  if (select count(*) from public.trending(24, 5)) = 0 then
    raise exception 'check 51 FAILED: trending is empty when signed out';
  end if;
  if (select count(*) from public.search_peels('verifysquare', false, 30)) = 0 then
    raise exception 'check 51 FAILED: search finds nothing when signed out';
  end if;
  if (select count(*) from public.peel_ancestors('c1000000-0000-0000-0000-000000000002', 25)) = 0 then
    raise exception 'check 51 FAILED: a reply has no ancestors when signed out';
  end if;

  -- bookmarks(user_id) in the embed literal: the grant is what stops the whole
  -- request erroring, and RLS with no applicable policy is what empties it.
  if (select count(*) from public.bookmarks) <> 0 then
    raise exception 'check 51 FAILED: a signed-out reader can see somebody''s bookmarks';
  end if;

  -- Nobody is hidden from nobody, and asking costs no grant on mutes or blocks.
  if public.hidden_from(null::uuid, 'c0000000-0000-0000-0000-000000000004') then
    raise exception 'check 51 FAILED: hidden_from hides a peel from a reader who is nobody';
  end if;

  -- A block is between two accounts, so it takes nothing off the square: a
  -- signed-out reader is always a third party to one.
  if not exists (select 1 from public.peels where id = 'c1000000-0000-0000-0000-000000000001')
     or not exists (select 1 from public.peels where id = 'c1000000-0000-0000-0000-000000000003') then
    raise exception 'check 51 FAILED: a block took a peel off the public square';
  end if;
end $$;

-- Nothing private is reachable at all. No grant, so each of these raises rather
-- than coming back empty -- "it errors" and "it is filtered" are different
-- promises and this is the stronger one.
do $$
declare t text;
begin
  foreach t in array array['mutes', 'blocks', 'notifications', 'conversations', 'messages', 'reports'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'check 51 FAILED: a signed-out reader can read public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- And the square is read-only: taking part in it still takes an account.
do $$ begin
  begin
    insert into public.peels (title, user_id) values ('posted by nobody', 'c0000000-0000-0000-0000-000000000001');
    raise exception 'check 51 FAILED: a signed-out visitor can peel';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.likes (user_id, peel_id)
      values ('c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
    raise exception 'check 51 FAILED: a signed-out visitor can like';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.follows (follower_id, followee_id)
      values ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');
    raise exception 'check 51 FAILED: a signed-out visitor can follow';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The other half of the guard: a mute is still a mute for the person holding it.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
  perform set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
end $$;
do $$ begin
  if not public.hidden_from('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004') then
    raise exception 'check 51 FAILED: the null-viewer guard swallowed a real mute';
  end if;
end $$;
reset role;
\echo check 51 ok: the square is public, and everything private is still private

rollback;
\echo ALL CHECKS PASSED
