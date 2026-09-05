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

-- 6. RLS enabled on every table, 11 policies, API roles have table grants.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('profiles','peels','likes','follows') and not rowsecurity) then
    raise exception 'check 6 FAILED: RLS not enabled on every table';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 11 then
    raise exception 'check 6 FAILED: expected 11 policies, found %', (select count(*) from pg_policies where schemaname = 'public');
  end if;
  if not has_table_privilege('authenticated', 'public.peels', 'insert') or not has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'check 6 FAILED: API roles lack table grants';
  end if;
  if not has_table_privilege('authenticated', 'public.peels', 'delete')
     or not has_table_privilege('authenticated', 'public.follows', 'insert')
     or not has_column_privilege('authenticated', 'public.profiles', 'bio', 'update') then
    raise exception 'check 6 FAILED: authenticated lacks the core-feature grants';
  end if;
end $$;
\echo check 6 ok: RLS on, 11 policies, grants present

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

rollback;
\echo ALL CHECKS PASSED
