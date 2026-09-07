-- Settings, reports, and the way out.
-- Apply after 20260913000000_column_grants.sql.

--------------------------------------------------------------------------------
-- reports: a queue with no screen
--------------------------------------------------------------------------------

-- One row per thing somebody flagged. There is no moderation page: this table
-- IS the queue, read with the service role, and the reporter is told "thanks,
-- we'll take a look" either way. That is the whole feature, and it is why the
-- rows have to be trustworthy without anybody watching them land.
--
-- A report points at a peel or at a profile, never both and never neither --
-- the sheet is the same either way, only its subject changes.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  peel_id uuid references public.peels (id) on update cascade on delete cascade,
  profile_id uuid references public.profiles (id) on update cascade on delete cascade,
  reason text not null
    constraint reports_reason check (reason in ('spam', 'abuse', 'other')),
  -- "Tell us in a line". Optional on every reason, and bounded by the same 280
  -- a peel gets, because it is free text a stranger typed.
  note text not null default ''
    constraint reports_note_length check (char_length(note) <= 280),
  constraint reports_one_subject check ((peel_id is null) <> (profile_id is null))
);

create index reports_created_idx on public.reports (created_at desc);

-- Reporting the same thing twice is not more information, and without this an
-- insert grant is an invitation to fill the table from a loop. A second report
-- of the same subject by the same person raises unique_violation, which the
-- server action reads as "already said, thank you" rather than as a failure.
create unique index reports_one_per_peel
  on public.reports (reporter_id, peel_id) where peel_id is not null;
create unique index reports_one_per_profile
  on public.reports (reporter_id, profile_id) where profile_id is not null;

alter table public.reports enable row level security;

-- This table was born wide open: Supabase's default privileges grant anon and
-- authenticated ALL on every new table in public, so `grant insert` below would
-- have been decoration and the queue would have been readable -- and deletable --
-- by anybody, signed in or not. Revoke first, then say what is allowed. See
-- 20260913000000_column_grants.sql; check 31 caught this one before it shipped.
revoke all on public.reports from anon, authenticated;

-- Insert only, and only as yourself. There is deliberately no select policy of
-- any kind: a report names the person who filed it, so making it readable would
-- publish who reported whom. The service role bypasses RLS and is how it is read.
create policy "authenticated users can report"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

grant insert on public.reports to authenticated;

--------------------------------------------------------------------------------
-- Deleting your account
--------------------------------------------------------------------------------

-- Everything a person has is reachable from their auth.users row: profiles hangs
-- off it `on delete cascade`, and peels, likes, follows, reposts, bookmarks,
-- media rows, notifications, forwarding handles and reports all hang off profiles
-- the same way. So the whole delete is one statement against a table the API
-- roles cannot touch -- which is the point of doing it here.
--
-- The alternative was a service-role client in the Next runtime calling the auth
-- admin API. That would put a key that bypasses every policy into the app's
-- process (one bad import from a client component), add an environment variable
-- to keep in sync, and -- the part that decided it -- put the destructive path
-- somewhere verify.sql could never reach. This function runs in the same
-- container as every other check, so checks 32 and 33 below are about the real
-- thing.
create function public.delete_account(confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  mine text;
  -- Case and a leading @ are the two things people type without meaning them,
  -- exactly as parseHandle() takes them off in lib/profile.ts. The app already
  -- does this; doing it again here is what makes it true rather than usual.
  typed text := lower(ltrim(btrim(coalesce(confirm, '')), '@'));
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;

  select p.username into mine from public.profiles p where p.id = me;
  if mine is null then
    raise exception 'no account to delete' using errcode = 'no_data_found';
  end if;

  -- The typed handle is the confirmation, and it has to be THIS account's. A
  -- caller who reaches the RPC directly still has to know whose session it is.
  if typed is distinct from mine then
    raise exception 'that is not your handle' using errcode = 'check_violation';
  end if;

  -- `where id = me`, never `where username = typed`: the session says who is
  -- being deleted, the typed handle only says that they meant it.
  delete from auth.users u where u.id = me;
end;
$$;

revoke execute on function public.delete_account(text) from public, anon;
grant execute on function public.delete_account(text) to authenticated;
