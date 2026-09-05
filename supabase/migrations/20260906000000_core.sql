-- Citrinia core features: reply threads, follows, profile bio, delete own peel.
-- Everything the MVP needs on top of the reconstructed 20260905000000_init.sql
-- schema. Apply via the dashboard SQL editor (or `supabase db push`).

-- Replies: a peel may hang off a parent peel. Deleting the parent composts the
-- whole thread.
alter table public.peels
  add column parent_id uuid references public.peels (id) on update cascade on delete cascade;

create index peels_parent_id_idx on public.peels (parent_id);
-- Profile timelines read peels by author, newest first.
create index peels_user_created_idx on public.peels (user_id, created_at desc);

-- Profile bio. Not null with a default so existing rows stay readable.
alter table public.profiles
  add column bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 160);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  followee_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

-- The primary key covers "who does ada follow"; this covers "who follows ada".
create index follows_followee_id_idx on public.follows (followee_id);

alter table public.follows enable row level security;

create policy "authenticated users can select follows"
  on public.follows for select to authenticated using (true);
create policy "authenticated users can follow"
  on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "authenticated users can unfollow"
  on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy "authenticated users can delete their own peels"
  on public.peels for delete to authenticated using (user_id = auth.uid());

-- username and avatar_url stay GitHub-owned: the column grant below is what
-- keeps them out of reach, since a policy cannot restrict columns.
create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Data API grants, scoped to what the policies above allow.
grant select, insert, delete on public.follows to authenticated;
grant delete on public.peels to authenticated;
grant update (name, bio) on public.profiles to authenticated;
