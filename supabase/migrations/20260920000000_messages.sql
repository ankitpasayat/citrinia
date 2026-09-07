-- Messages: the one part of Citrinia that is not addressed to everybody.
-- Apply after 20260919000000_thread.sql.
--
-- TWO tables, where the artifact sketched three. It had a conversation_members
-- row per side carrying accepted_at and last_read_at, and for a 1:1 conversation
-- that row is a table's worth of ceremony around two facts:
--
--   * The request state is not per-side. Only the person who did NOT start the
--     conversation can have one pending -- the sender always sees an ordinary
--     conversation and is never told it is waiting -- so `accepted_at` plus
--     `started_by` says everything a pair of member rows would.
--   * The read state IS per-side, and it is two timestamps. `a_read_at` and
--     `b_read_at` behind a `case when a = auth.uid()` costs one expression at
--     each of the four places that ask, against a join at every one of them
--     plus a second insert on every new conversation.
--
-- What the pair columns buy beyond that: `a < b` with a unique index means a
-- conversation between two people is found (or refused as a duplicate) in one
-- lookup, with no room for the two-rows-disagree state a members table has.
--
-- The unread rule is deliberately NOT computed here. lib/messages.ts owns it,
-- and both the list and the badge read the same rows and apply the same
-- function -- one definition rather than one in SQL and one in TypeScript that
-- drift the first time either changes.

--------------------------------------------------------------------------------
-- conversations
--------------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- The pair, always in this order, so (a, b) can be unique. `a` is not the
  -- starter and `b` is not the recipient: which is which is `started_by`.
  a uuid not null references public.profiles (id) on update cascade on delete cascade,
  b uuid not null references public.profiles (id) on update cascade on delete cascade,
  -- Who sent the first message. Their side is accepted by definition.
  started_by uuid not null references public.profiles (id) on update cascade on delete cascade,
  -- Null means the other person has not accepted yet: it is a request, and it
  -- shows on their Requests tab rather than in their list or on their badge.
  accepted_at timestamptz,
  -- The three columns the list reads instead of the messages table. Kept by
  -- bump_conversation() on every insert, so nothing else may write them.
  last_message_at timestamptz not null default now(),
  last_sender_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  last_preview text not null default ''
    constraint conversations_preview_length check (char_length(last_preview) <= 140),
  -- Per side, and the only columns whose meaning depends on which side you are.
  a_read_at timestamptz,
  b_read_at timestamptz,
  constraint conversations_ordered check (a < b),
  constraint conversations_pair unique (a, b),
  constraint conversations_started_by_member check (started_by in (a, b)),
  constraint conversations_last_sender_member check (last_sender_id in (a, b))
);

-- "My conversations, newest first" is the list, the badge and the requests tab.
-- Two indexes because the pair lives in two columns: `a = me or b = me` is a
-- bitmap of both, and neither half is a sequential scan.
create index conversations_a_idx on public.conversations (a, last_message_at desc);
create index conversations_b_idx on public.conversations (b, last_message_at desc);

--------------------------------------------------------------------------------
-- messages
--------------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on update cascade on delete cascade,
  sender_id uuid not null references public.profiles (id) on update cascade on delete cascade,
  body text not null
    constraint messages_body_length check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- One conversation's messages, newest first: what the screen reads, and the
-- order the 50-message ceiling cuts on.
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);

--------------------------------------------------------------------------------
-- Who may see and write what
--------------------------------------------------------------------------------

-- Born wide open; see 20260913000000_column_grants.sql. Every new table.
revoke all on public.conversations from anon, authenticated;
revoke all on public.messages from anon, authenticated;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "the two people in a conversation can see it"
  on public.conversations for select to authenticated
  using (auth.uid() in (a, b));

-- send_message() is SECURITY INVOKER, so this policy -- not the function -- is
-- what a crafted request hits too. Everything the function is trusted to do is
-- therefore said here: you are in it, you started it, the last message is yours,
-- and a block between the two of you refuses the whole conversation.
--
-- The last clause is the request flow's wall. Without it anybody could insert
-- their own conversation with `accepted_at` already set and land straight in a
-- stranger's list, past Requests -- which is exactly what Requests is for.
create policy "you can start a conversation you are in"
  on public.conversations for insert to authenticated
  with check (
    auth.uid() in (a, b)
    and started_by = auth.uid()
    and last_sender_id = auth.uid()
    and not public.blocks_between(a, b)
    and (
      accepted_at is null
      or exists (
        select 1 from public.follows f
        where f.follower_id = (case when a = auth.uid() then b else a end)
          and f.followee_id = auth.uid()
      )
    )
  );

-- Binning a request. Only a pending one, and only the person it was addressed
-- to: a conversation you are part of is not yours alone to erase once it is
-- accepted, and nobody may delete the request they themselves sent out of
-- somebody else's inbox. Messages cascade with it.
create policy "you can bin a request you did not ask for"
  on public.conversations for delete to authenticated
  using (auth.uid() in (a, b) and accepted_at is null and started_by <> auth.uid());

-- No UPDATE policy and no update grant. accepted_at, the read stamps and the
-- three `last_` columns are written by the two definer functions below and by
-- bump_conversation(), which is the only way they can be trusted.

create policy "you can read the messages in your conversations"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.a, c.b)
    )
  );

-- Anyone may write to anyone who has not blocked them -- the request flow is
-- about where the message LANDS, never about whether it may be sent.
--
-- blocks_between(), not hidden_from(): a mute is a filter the muter applies to
-- their own feeds, and hidden_from() is true when EITHER person has muted the
-- other, so using it here would quietly stop you messaging somebody whose peels
-- you had merely muted. A block is the rule about two people, and it is the only
-- one that belongs on a message. (The artifact says hidden_from; this is a
-- deliberate correction to it.)
create policy "you can write into your own conversations"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.a, c.b)
        and not public.blocks_between(c.a, c.b)
    )
  );

-- No update and no delete on messages: an edited or vanishing message is a
-- feature nobody asked for, and not granting it is how it stays that way.
grant select, insert, delete on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

--------------------------------------------------------------------------------
-- Sending
--------------------------------------------------------------------------------

-- Send `body` to `to_user`, making the conversation if this is the first one.
-- Returns the whole message row, so the browser can replace its optimistic copy
-- with the real id and timestamp, and learn the conversation id it now lives in.
--
-- SECURITY INVOKER, like add_thread() and for the same reason: it is not a way
-- past any rule. Both policies above still run, so a blocked sender is refused
-- here exactly as they would be posting the insert by hand.
--
-- Why a function rather than three round trips from the browser: "find the
-- conversation, make one if there isn't one, write the message" is one act, and
-- split across three requests it has a window in the middle where two people
-- messaging each other for the first time at the same moment make two
-- conversations. Here the unique index settles that race inside one statement.
create function public.send_message(to_user uuid, body text)
returns public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  low uuid;
  high uuid;
  conv uuid;
  wrote public.messages;
begin
  if me is null then
    raise exception 'sign in to send a message' using errcode = 'insufficient_privilege';
  end if;
  if to_user is null or to_user = me then
    raise exception 'a message needs somebody else to go to' using errcode = 'invalid_parameter_value';
  end if;

  low := least(me, to_user);
  high := greatest(me, to_user);

  select c.id into conv from public.conversations c where c.a = low and c.b = high;

  if conv is null then
    insert into public.conversations (a, b, started_by, last_sender_id, accepted_at)
    values (
      low, high, me, me,
      -- Accepted on the spot when they already follow you; otherwise this is a
      -- request and `accepted_at` stays null until they answer it.
      case when exists (
        select 1 from public.follows f
        where f.follower_id = to_user and f.followee_id = me
      ) then now() end
    )
    on conflict (a, b) do nothing
    returning id into conv;

    -- Lost the race: somebody's first message to us landed while this one was
    -- being written. Their conversation is the conversation.
    if conv is null then
      select c.id into strict conv from public.conversations c where c.a = low and c.b = high;
    end if;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (conv, me, body)
  returning * into wrote;

  return wrote;
end;
$$;

revoke execute on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

--------------------------------------------------------------------------------
-- What a new message does to the conversation it lands in
--------------------------------------------------------------------------------

-- The list reads `last_message_at`, `last_sender_id` and `last_preview` instead
-- of the messages table -- PostgREST cannot order a list by a column of another
-- table, and "the newest message of each conversation" is not a query it can
-- write at all. So the three of them are kept here, on the one event that can
-- change them.
--
-- Accepting by replying rides along: answering a request IS accepting it, and
-- doing it in this trigger means it cannot come apart from the message that
-- accepted it.
--
-- SECURITY DEFINER because nobody holds UPDATE on conversations, which is the
-- point: these columns are derived, and a person who could write them by hand
-- could put words in the list that were never sent.
create function public.bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set last_message_at = new.created_at,
         last_sender_id = new.sender_id,
         -- A preview, not a copy: 140 characters is what the row shows.
         last_preview = left(new.body, 140),
         accepted_at = case
                         when c.accepted_at is null and new.sender_id <> c.started_by
                         then new.created_at
                         else c.accepted_at
                       end
   where c.id = new.conversation_id;
  return null;
end;
$$;

create trigger bump_conversation after insert on public.messages
  for each row execute function public.bump_conversation();

-- Following somebody accepts the request they sent you. You have just said you
-- want to hear from them; making them wait behind a second button after that is
-- the sort of thing that makes an inbox feel like paperwork.
--
-- Definer for the same reason as above, and an AFTER trigger on follows so it
-- cannot be forgotten by whichever screen the follow came from -- the button on
-- a profile, the suggestions, the followers list.
create function public.accept_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set accepted_at = now()
   where c.accepted_at is null
     and c.started_by = new.followee_id
     and ((c.a = new.follower_id and c.b = new.followee_id)
       or (c.a = new.followee_id and c.b = new.follower_id));
  return new;
end;
$$;

create trigger accept_requests_on_follow after insert on public.follows
  for each row execute function public.accept_on_follow();

--------------------------------------------------------------------------------
-- Reading, and accepting on purpose
--------------------------------------------------------------------------------

-- Mark this conversation read, for whichever side the caller is. Definer, and
-- the `case` is what keeps it to their own side: a member cannot mark the other
-- person's copy read, which a column grant plus an UPDATE policy could not have
-- said (a policy chooses rows, never columns).
create function public.mark_read(conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations c
     set a_read_at = case when c.a = auth.uid() then now() else c.a_read_at end,
         b_read_at = case when c.b = auth.uid() then now() else c.b_read_at end
   where c.id = conversation and auth.uid() in (c.a, c.b);
$$;

revoke execute on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

-- Accept a request without answering it yet. Only the person it was sent to,
-- only while it is still pending, and it can never un-accept: `accepted_at is
-- null` in the where clause is what makes calling this twice harmless.
create function public.accept_conversation(conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations c
     set accepted_at = now()
   where c.id = conversation
     and c.accepted_at is null
     and c.started_by <> auth.uid()
     and auth.uid() in (c.a, c.b);
$$;

revoke execute on function public.accept_conversation(uuid) from public, anon;
grant execute on function public.accept_conversation(uuid) to authenticated;

--------------------------------------------------------------------------------
-- Live
--------------------------------------------------------------------------------

-- Only messages, and only inserts matter, so the default replica identity (the
-- primary key) is enough -- unlike notifications, whose deletes had to carry
-- the whole old row for the bell's filter to match.
--
-- No filter is needed on the subscribing side either: Realtime evaluates the
-- SELECT policy above per subscriber, so "every message insert" already means
-- "every message in one of my conversations" by the time it reaches a browser.
-- conversations itself is not published: a new message is the only event the
-- list, the badge and the open conversation care about, and it always comes
-- with one.
alter publication supabase_realtime add table public.messages;
