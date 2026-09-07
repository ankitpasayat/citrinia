-- Search that can rank: one function behind both result tabs.
-- Apply after 20260917000000_trending.sql.
--
-- SECURITY INVOKER for the same reason trending() is: RLS on peels hides a
-- blocked author's rows and `hidden_from()` hides a muted one's, so the function
-- only asks the question and never decides the answer.

--------------------------------------------------------------------------------
-- search_peels
--------------------------------------------------------------------------------

-- The peels a search finds, in the order the tab asked for: `top` ranks by the
-- likes and replies each one drew, otherwise it is newest first. Ids only -- the
-- app hydrates them through the same fetchPeels() every other list uses, so a
-- search result and a feed card are the same card.
--
-- Why a function rather than a REST filter, which is what search used before:
--   * ordering by likes+replies is an aggregate over two other tables, which
--     PostgREST cannot sort on at all;
--   * a term of `#chai` should find the tag and not `#chaiwala`, which needs the
--     word-boundary pattern above, and needs BOTH tabs to use it or the two
--     tabs disagree about what matched;
--   * muted authors drop out here rather than in the app, so the page size is
--     decided after the filter instead of before it.
--
-- The term is data, never a pattern: only a term that is entirely `#` plus tag
-- characters reaches the regex, and that shape has no metacharacter in it. Every
-- other term goes through strpos(), which cannot be a pattern at all -- which is
-- also why the app no longer has to escape `%` and `*` before searching.
--
-- ponytail: `top` ranks the newest 500 matches, not every match. Ranking the
-- whole corpus would mean counting likes and replies for every peel containing
-- "the"; 500 is far more than the 30 shown and bounds the work at two index
-- lookups each. A word common enough to have more than 500 matches will not miss
-- its best peel by much, and Latest still reaches everything through its order.
create function public.search_peels(term text, top boolean default false, max_rows int default 30)
returns table (peel_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with pool as (
    select p.id, p.created_at
    from public.peels p
    where coalesce(term, '') <> ''
      and not public.hidden_from(auth.uid(), p.user_id)
      and case
            when term ~ '^#[[:alnum:]_]{1,50}$'
              then p.title ~* ('(?<![[:alnum:]_])' || term || '(?![[:alnum:]_])')
            else strpos(lower(p.title), lower(term)) > 0
          end
    order by p.created_at desc, p.id desc
    limit 500
  )
  select pool.id
  from pool
  order by
    -- CASE evaluates one arm, so Latest never pays for the two counts.
    case when coalesce(top, false) then
      (select count(*) from public.likes l where l.peel_id = pool.id)
      + (select count(*) from public.peels r where r.parent_id = pool.id)
    else 0 end desc,
    pool.created_at desc, pool.id desc
  limit least(greatest(coalesce(max_rows, 30), 1), 100);
$$;

revoke execute on function public.search_peels(text, boolean, int) from public, anon;
grant execute on function public.search_peels(text, boolean, int) to authenticated;
