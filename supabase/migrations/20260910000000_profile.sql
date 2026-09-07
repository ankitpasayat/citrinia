-- Citrinia profile slice: what a profile says about a person past a name and a
-- bio -- a banner behind the avatar, where they are, where else to find them,
-- and since when -- plus the `avatars` bucket those two pictures live in.
-- Apply after 20260909000000_thread_ancestors.sql.

--------------------------------------------------------------------------------
-- The columns
--------------------------------------------------------------------------------

-- Empty string, not null, is "not set" here: it matches bio, and it keeps every
-- reader off `?? ''`. `created_at` defaults to now() for rows made from here on
-- and is backfilled from auth.users below for the ones already in the table.
alter table public.profiles
  add column banner_url text not null default '',
  add column location text not null default '',
  add column website text not null default '',
  add column created_at timestamptz not null default now();

-- The url columns are checked for their SCHEME, not just their length. All three
-- come back out of the database as an <img src> or an <a href>, and the grant at
-- the bottom of this file hands them to their owner -- which means a signed-in
-- browser can PostgREST straight at them without going through the app's action.
-- So the app cannot be the gate that keeps `javascript:` out of an href; this is.
--
-- A picture is one of ours, so it takes what peel_media.url takes: https, or a
-- loopback url, because a local Supabase stack serves Storage over http. A
-- website is a link somebody typed at us and points outward, so it is https
-- only -- lib/profile.ts upgrades what they type rather than refusing it.
create function public.storable_picture_url(url text)
returns boolean
language sql
immutable
returns null on null input
as $$
  select url = ''
      or (char_length(url) <= 500
          and (url ~ '^https://' or url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'))
$$;

alter table public.profiles
  add constraint profiles_avatar_url_ok check (public.storable_picture_url(avatar_url)),
  add constraint profiles_banner_url_ok check (public.storable_picture_url(banner_url)),
  add constraint profiles_website_ok
    check (website = '' or (website ~ '^https://' and char_length(website) <= 100)),
  add constraint profiles_location_length check (char_length(location) <= 30);

-- "Joined" is a fact about the account, so it comes from the account. Profiles
-- made before this column existed get their real signup date rather than the
-- date of this migration.
update public.profiles p
   set created_at = u.created_at
  from auth.users u
 where u.id = p.id and u.created_at is not null;

-- Column grants are what keep username out of reach (a policy cannot restrict
-- columns, and the existing "users can update their own profile" policy allows
-- the whole row). Granting avatar_url and banner_url is what lets the browser
-- finish an upload without a server round trip; the constraints above are what
-- make that safe. username stays ungranted until slice 4c gives it a history.
grant update (name, bio, location, website, avatar_url, banner_url)
  on public.profiles to authenticated;

--------------------------------------------------------------------------------
-- Signup, against the new constraint
--------------------------------------------------------------------------------

-- The trigger wrote `raw_user_meta_data->>'avatar_url'` straight into a NOT NULL
-- column, so a provider that sends no avatar aborted the signup -- and with the
-- constraint above, so would one that sends a url we would not store.
-- Neither is worth failing an account over: an avatar we cannot use is no
-- avatar, and Avatar falls back to initials. Everything else is unchanged.
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
    new.raw_user_meta_data->>'user_name',
    avatar
  );
  return new;
end;
$$;

--------------------------------------------------------------------------------
-- Storage: the `avatars` bucket
--------------------------------------------------------------------------------

-- Same defensive shape as ensure_media_bucket() in 20260907000000_social.sql,
-- generalised, because this is the second bucket and there will not be a third
-- copy of it: the `storage` schema belongs to the platform, so it may be empty
-- (the throwaway container in supabase/verify.sh), it may be missing the newer
-- `buckets` columns, and `postgres` may not be allowed to touch its policies.
-- None of that should abort a migration whose real subject is `public`, so this
-- reports what it managed instead of raising. Idempotent.
--
-- If it reports it could not do the storage half, make the bucket by hand in
-- Dashboard -> Storage with the id, size and types passed below, and add the
-- three policies from Storage -> Policies.
create or replace function public.ensure_public_bucket(bucket text, limit_bytes bigint, mimes text[])
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  cols text[];
  col_list text := 'id, name, public';
  val_list text := format('%L, %L, true', bucket, bucket);
  mime_sql constant text := format('%L::text[]', mimes);
  made int := 0;
begin
  if to_regclass('storage.buckets') is null then
    return 'skipped: no storage.buckets in this database';
  end if;

  select array_agg(c.column_name::text) into cols
  from information_schema.columns c
  where c.table_schema = 'storage' and c.table_name = 'buckets';

  -- Both columns arrived after the original storage schema, so neither is assumed.
  if 'file_size_limit' = any (cols) then
    col_list := col_list || ', file_size_limit';
    val_list := val_list || ', ' || limit_bytes::text;
  end if;
  if 'allowed_mime_types' = any (cols) then
    col_list := col_list || ', allowed_mime_types';
    val_list := val_list || ', ' || mime_sql;
  end if;

  begin
    execute format('insert into storage.buckets (%s) values (%s) on conflict (id) do nothing',
                   col_list, val_list);
    -- A bucket that already exists (a re-run, or one made in the dashboard) is
    -- brought in line with this call.
    execute format('update storage.buckets set public = true where id = %L', bucket);
    if 'file_size_limit' = any (cols) then
      execute format('update storage.buckets set file_size_limit = %s where id = %L', limit_bytes, bucket);
    end if;
    if 'allowed_mime_types' = any (cols) then
      execute format('update storage.buckets set allowed_mime_types = %s where id = %L', mime_sql, bucket);
    end if;
  exception when insufficient_privilege then
    return format('skipped: no rights on storage.buckets; create the %s bucket in the dashboard', bucket);
  end;

  if to_regclass('storage.objects') is null then
    return 'bucket ready; no storage.objects, so no policies';
  end if;

  -- Public read, because the url is handed to <img>. Writes and deletes are
  -- confined to a folder named after the uploader's uid, so nobody can
  -- overwrite or remove anybody else's file.
  begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = bucket || ' is publicly readable') then
      execute format($v$create policy %I on storage.objects
                       for select using (bucket_id = %L)$v$,
                     bucket || ' is publicly readable', bucket);
      made := made + 1;
    end if;
    if not exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'users upload ' || bucket || ' to their own folder') then
      execute format($v$create policy %I on storage.objects
                       for insert to authenticated
                       with check (bucket_id = %L
                                   and (storage.foldername(name))[1] = auth.uid()::text)$v$,
                     'users upload ' || bucket || ' to their own folder', bucket);
      made := made + 1;
    end if;
    if not exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'users delete their own ' || bucket) then
      execute format($v$create policy %I on storage.objects
                       for delete to authenticated
                       using (bucket_id = %L
                              and (storage.foldername(name))[1] = auth.uid()::text)$v$,
                     'users delete their own ' || bucket, bucket);
      made := made + 1;
    end if;
  exception when insufficient_privilege then
    return format('bucket ready; no rights on storage.objects, add its 3 policies in the dashboard');
  end;

  return format('%s bucket ready; %s storage policies added, 3 in place', bucket, made);
end;
$fn$;

revoke execute on function public.ensure_public_bucket(text, bigint, text[]) from public, anon, authenticated;

-- 5 MB, and only what a browser will certainly render as a picture. No video:
-- an avatar is not a peel attachment, and the smaller ceiling is the point of
-- keeping this out of the `media` bucket.
do $$ begin
  raise notice '%', public.ensure_public_bucket(
    'avatars', 5242880, array['image/jpeg','image/png','image/gif','image/webp']);
end $$;
