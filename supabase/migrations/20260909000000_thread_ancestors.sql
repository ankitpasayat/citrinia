-- The conversation above a reply. Opening a peel that answers something shows
-- what it answers, and that chain is a walk up parent_id -- which from the app
-- would be one round trip per level, on a page that is already three queries.

-- The walk reads parent_id and then looks the parent up by id; the primary key
-- covers the second half and peels_parent_id_idx is not what this needs.

create function public.peel_ancestors(of_peel uuid, max_depth int default 25)
returns table (id uuid, depth int)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive up as (
    -- Depth 1 is the peel it answers; a top-level peel starts nothing.
    select p.parent_id as id, 1 as depth
    from public.peels p
    where p.id = of_peel and p.parent_id is not null
    union all
    select parent.parent_id, up.depth + 1
    from up
    join public.peels parent on parent.id = up.id
    where parent.parent_id is not null
      -- Both a bound on the work and the thing that ends a parent_id cycle:
      -- nothing stops one being made by hand, and depth only ever grows.
      and up.depth < least(greatest(coalesce(max_depth, 25), 1), 100)
  )
  -- Deepest first, which is the root first: the page reads top to bottom.
  select up.id, up.depth from up order by up.depth desc;
$$;

-- Row-level security still applies (`security invoker`), so a peel the reader
-- cannot see ends the walk there rather than leaking what it answers.

-- Supabase's default privileges hand EXECUTE on new functions to anon and
-- authenticated, so revoking from PUBLIC alone would not be enough.
revoke execute on function public.peel_ancestors(uuid, int) from public, anon, authenticated;
grant execute on function public.peel_ancestors(uuid, int) to authenticated;
