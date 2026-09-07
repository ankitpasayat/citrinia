-- A thread posts or it doesn't: every peel in it, and every picture on them, in
-- one transaction.
-- Apply after 20260918000000_link_previews.sql.
--
-- SECURITY INVOKER, like trending() and search_peels(). It is not a way past any
-- rule: the peels insert policy still demands user_id = auth.uid() and still
-- refuses a parent or a quote from somebody who has blocked you, peel_media
-- still checks the url and the alt text, and the notify trigger still fires per
-- peel. All this function adds is the chain -- each peel is a reply to the one
-- before -- and the transaction around the lot.
--
-- Why here rather than a loop in the server action: a loop that fails half way
-- has to undo what it already did, and it cannot undo anything if the process
-- that was doing the looping is the thing that died. A function fails as one
-- statement, so the failure mode is "nothing posted", which is the only failure
-- mode worth having. It is also one round trip instead of two per peel.

--------------------------------------------------------------------------------
-- add_thread
--------------------------------------------------------------------------------

-- Post `items` as a chain: the first peel hangs off `parent` (null for a new
-- peel) and embeds `quote`, and each one after it is a reply to the peel before.
-- Returns the new ids in the order they were written, oldest first.
--
-- One item is an ordinary peel, which is why this is the only insert path the
-- composer has: a thread of one and a peel are the same act, so they take the
-- same route and get the same guarantees. Media rides along per item, taking its
-- position from where it sits in the array.
--
-- `quote` is the first peel's alone. A quote embeds one peel; a chain of them
-- would show the same card five times over, which nobody asked for.
--
-- The 25 ceiling is peel_ancestors()'s default depth, so the last peel of the
-- longest thread still draws its whole chain on the peel page. It also bounds
-- the work: 25 inserts is the most one call can ever cost.
create function public.add_thread(items jsonb, parent uuid default null, quote uuid default null)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  made uuid[] := array[]::uuid[];
  prev uuid := parent;
  new_id uuid;
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'a thread is an array of peels' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 25 then
    raise exception 'a thread is 1 to 25 peels' using errcode = 'invalid_parameter_value';
  end if;

  for item in
    select e.value from jsonb_array_elements(items) with ordinality as e(value, n) order by e.n
  loop
    insert into public.peels (title, user_id, parent_id, quote_id)
    values (item->>'title', auth.uid(), prev, case when cardinality(made) = 0 then quote end)
    returning id into new_id;

    -- `jsonb_typeof` rather than coalesce: a missing key is SQL NULL, but a
    -- `"media": null` is a jsonb null, and only one of those two survives
    -- coalesce. Both mean the same thing here -- nothing attached.
    insert into public.peel_media (peel_id, position, kind, url, alt, width, height)
    select new_id, m.n - 1, m.value->>'kind', m.value->>'url', coalesce(m.value->>'alt', ''),
           (m.value->>'width')::int, (m.value->>'height')::int
    from jsonb_array_elements(
           case when jsonb_typeof(item->'media') = 'array' then item->'media' else '[]'::jsonb end
         ) with ordinality as m(value, n);

    made := made || new_id;
    prev := new_id;
  end loop;

  return made;
end;
$$;

-- A new function is executable by PUBLIC until it is told otherwise, and anon
-- has no peel to post.
revoke execute on function public.add_thread(jsonb, uuid, uuid) from public, anon;
grant execute on function public.add_thread(jsonb, uuid, uuid) to authenticated;
