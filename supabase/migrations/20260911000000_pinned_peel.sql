-- The one peel a profile leads with. Apply after 20260910000000_profile.sql.

-- Null is "nothing pinned", which is most profiles, so this column is nullable
-- where the rest of the profile's new fields are empty-string-not-null: there is
-- no peel id that means "no peel". Composting the pinned peel unpins it rather
-- than taking the profile down with it.
alter table public.profiles
  add column pinned_peel_id uuid
    references public.peels (id) on update cascade on delete set null;

-- The pin is written by its owner through PostgREST like the rest of the
-- profile, and a CHECK cannot look at another table -- so the rule that a
-- pinned peel has to be YOUR peel lives in a trigger. Without it, anyone could
-- lead their profile with a stranger's peel, over that stranger's name.
--
-- security definer so the check is real even if peels' select policy is ever
-- narrowed: a rule that can be starved of rows is not a rule.
create function public.pinned_peel_must_be_yours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pinned_peel_id is not null
     and not exists (
       select 1 from public.peels p
        where p.id = new.pinned_peel_id and p.user_id = new.id
     ) then
    raise exception 'a pinned peel must be one of your own'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- `of pinned_peel_id` so ordinary profile edits do not pay for this.
create trigger profiles_pinned_peel_is_yours
  before insert or update of pinned_peel_id on public.profiles
  for each row execute function public.pinned_peel_must_be_yours();

grant update (pinned_peel_id) on public.profiles to authenticated;
