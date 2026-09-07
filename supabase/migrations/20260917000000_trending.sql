-- Trending: what the day is talking about.
-- Apply after 20260916000000_blocks.sql.
--
-- One index and one function. `trending()` pulls #tags out of the last day's
-- peels and ranks them. The next migration adds the search half of the slice and
-- leans on the same index.
--
-- SECURITY INVOKER, which is what makes it safe to expose: RLS on peels is what
-- hides a blocked person's rows, and `hidden_from()` (see
-- 20260915000000_mutes.sql) is what hides a muted one's. The function does not
-- decide who may see what -- it only asks.

--------------------------------------------------------------------------------
-- The index the slice leans on
--------------------------------------------------------------------------------

-- peels_timeline_idx covers the feed, but it is partial (`where parent_id is
-- null`), and trending reads replies too: a hashtag in a reply is a use of that
-- hashtag. This is the same keyset shape over every peel, so trending's 24-hour
-- range walks it and stops -- and so does the search in the next migration,
-- which wants the newest N matches in exactly this order.
create index peels_created_idx on public.peels (created_at desc, id desc);

--------------------------------------------------------------------------------
-- trending
--------------------------------------------------------------------------------

-- What the day is talking about: the hashtags in the last `hours` of peels,
-- ranked by how many DIFFERENT people used them. Counting peels alone would let
-- one person peeling the same tag fifty times decide what is trending; counting
-- authors means a tag has to spread before it rises.
--
-- The tie-break is the honest part. On a young site almost every tag has exactly
-- one author, and ranking by authors alone leaves those in whatever order the
-- planner happens to return -- a list that reshuffles between page loads and
-- means nothing. So a tie on authors is broken by the likes and replies its
-- peels drew, then by how many peels carried it, then by the tag itself, which
-- is unique per row and therefore makes the whole order deterministic.
--
-- `peels` and `people` are both returned because they are different numbers and
-- the screen shows the first one: a row that says "12 peels" while it was ranked
-- on 3 people should be able to say so rather than quietly print one as the other.
--
-- The tag pattern is lib/text.ts's, transcribed: a `#` only starts a tag at a
-- word boundary, so neither `C#sharp` nor the `#bee` in `#ay#bee` is one. The
-- lookbehind is what buys that agreement -- the consuming `(?:^|[^…])` form the
-- mention trigger uses would find that `#bee`, and then a tag counted here would
-- not be a tag the reader can see. Checked against tokenize() on the same
-- strings, Devanagari and accents included: both stop where the other does.
create function public.trending(hours int default 24, max_rows int default 5)
returns table (tag text, peels int, people int)
language sql
stable
security invoker
set search_path = ''
as $$
  with tagged as (
    select lower(m[1]) as tag, p.id, p.user_id
    from public.peels p
    cross join lateral regexp_matches(p.title, '(?<![[:alnum:]_])#([[:alnum:]_]{1,50})', 'g') as m
    -- A window is bounded on both ends: a null or a silly one means the default,
    -- and a month is as far back as anything here calls "trending".
    where p.created_at > now() - make_interval(hours => least(greatest(coalesce(hours, 24), 1), 720))
      and not public.hidden_from(auth.uid(), p.user_id)
  ),
  -- One row per (tag, peel): a peel that says #chai twice used the tag once.
  -- The weight is what that peel drew, counted once here rather than per mention.
  weighted as (
    select distinct t.tag, t.id, t.user_id,
      (select count(*) from public.likes l where l.peel_id = t.id)
      + (select count(*) from public.peels r where r.parent_id = t.id) as weight
    from tagged t
  )
  select w.tag, count(*)::int, count(distinct w.user_id)::int
  from weighted w
  group by w.tag
  order by count(distinct w.user_id) desc, sum(w.weight) desc, count(*) desc, w.tag
  limit least(greatest(coalesce(max_rows, 5), 1), 50);
$$;

-- A new function is granted to PUBLIC by default. Trending is a signed-in
-- screen, and the function reads peels, which anon cannot: say so rather than
-- leaving it to another grant to fail. See 20260915000000_mutes.sql.
revoke execute on function public.trending(int, int) from public, anon;
grant execute on function public.trending(int, int) to authenticated;
