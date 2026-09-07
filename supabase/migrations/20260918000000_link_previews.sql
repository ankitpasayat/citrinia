-- Link previews: the card under a peel that carries a link.
-- Apply after 20260917010000_search.sql.
--
-- One table, keyed by the url itself. A link shared a hundred times is fetched
-- once and every peel carrying it reads the same row -- which is why there is no
-- column on peels: the link is already in the text, and lib/link-preview.ts
-- finds it the same way on the way in and on the way out.
--
-- The trust question, decided 2026-09-07. The app holds only the anon key, so
-- anything the server action can write here, a signed-in person can write
-- directly with a crafted request. Rather than put a service_role key into the
-- Next runtime (the README's rule: it lives in Actions secrets and nowhere
-- else), the row is made as inert as a row can be:
--
--   * INSERT only. Nobody may UPDATE or DELETE, so the first writer wins and a
--     card cannot be rewritten under a peel after the fact.
--   * The card's site line and its href are built from the url at render time,
--     never from this row -- see components/link-preview-card.tsx. So the worst
--     a forged row can do is put a wrong headline on a card that still,
--     truthfully, names and points at the real domain. That is the same thing
--     anybody can already do by typing a lie in their own peel.
--   * The lengths are capped here and not only in the app, because this is the
--     wall a crafted request actually hits.
--
-- There is deliberately no `site` column, though the artifact's sketch had one:
-- og:site_name would be the one field on the card that claims to say who wrote
-- the page while coming from the least trustworthy place we have. The hostname
-- says the same thing and cannot be forged.

create table public.link_previews (
  url text primary key
    constraint link_previews_url_length check (char_length(url) <= 2048)
    -- https, or loopback -- the e2e suite serves the page it previews from
    -- 127.0.0.1, exactly as local Storage does for peel_media. The app only ever
    -- follows a loopback url when LINK_PREVIEW_TEST_ORIGIN names it.
    constraint link_previews_url_scheme
      check (url ~ '^https://' or url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'),
  -- All three are optional: a page that answers with no Open Graph tags at all
  -- still earns a row, so it is not re-fetched by every peel that mentions it.
  -- An empty string is not a title, so the floor is one character.
  title text
    constraint link_previews_title_length check (title is null or char_length(title) between 1 and 200),
  description text
    constraint link_previews_description_length
      check (description is null or char_length(description) between 1 and 400),
  image_url text
    constraint link_previews_image_length check (image_url is null or char_length(image_url) <= 2048)
    constraint link_previews_image_scheme
      check (image_url is null
             or image_url ~ '^https://'
             or image_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'),
  -- What a refresh would sweep on, and the only way to tell a row fetched today
  -- from one fetched in March. Nothing refreshes yet; a row is written once.
  fetched_at timestamptz not null default now()
);

-- Born wide open; see 20260913000000_column_grants.sql. Every new table.
revoke all on public.link_previews from anon, authenticated;

alter table public.link_previews enable row level security;

-- Readable by anyone signed in: the point of keying on the url is that one
-- fetch serves everybody. There is nothing personal on the row.
create policy "authenticated users can see link previews"
  on public.link_previews for select to authenticated using (true);
-- Writable by anyone signed in, because the server action writes as the person
-- posting. Insert-once is what bounds that; see the note at the top.
create policy "authenticated users can record a link preview"
  on public.link_previews for insert to authenticated with check (true);

-- No update, no delete, and no policy for either: a grant without a policy still
-- writes nothing, but saying it twice is what makes the intent survive a later
-- edit. anon gets neither -- it cannot read peels, so it has no card to draw.
grant select, insert on public.link_previews to authenticated;
