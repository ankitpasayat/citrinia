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

-- 6. RLS enabled on all three tables, 6 policies, API roles have table grants.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('profiles','peels','likes') and not rowsecurity) then
    raise exception 'check 6 FAILED: RLS not enabled on every table';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 6 then
    raise exception 'check 6 FAILED: expected 6 policies, found %', (select count(*) from pg_policies where schemaname = 'public');
  end if;
  if not has_table_privilege('authenticated', 'public.peels', 'insert') or not has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'check 6 FAILED: API roles lack table grants';
  end if;
end $$;
\echo check 6 ok: RLS on, 6 policies, grants present

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

rollback;
\echo ALL CHECKS PASSED
