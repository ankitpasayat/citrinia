// Conversation reads. Server-only: pass the request's Supabase client in, the
// way lib/peels.ts does.
//
// None of these queries names the viewer. The conversations policy is
// `auth.uid() in (a, b)` and the messages policy is "a conversation you are in",
// so "mine" is what the database returns and a filter here would only be a
// second, weaker copy of the rule -- one that could drift from it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { byNewest, otherId, pair, type Conversation, type Message } from "./messages.ts";

/**
 * One screenful of messages. Older ones age out rather than paginate, exactly as
 * notifications do -- a conversation that needs scrollback is a feature nobody
 * has asked for yet.
 */
export const MESSAGE_LIMIT = 50;

/** How many conversations a list shows. See the note on fetchConversations. */
export const LIST_LIMIT = 100;

/** A conversation and the person it is with, which is all any screen needs. */
export type Thread = { conversation: Conversation; other: Profile };

/**
 * Every conversation the viewer is in, newest first, requests included -- the
 * list splits them with lib/messages.ts, and the badge counts the same rows.
 *
 * ponytail: one page of 100 and no cursor. The badge re-reads this on every
 * navigation, so the ceiling is what keeps that cheap; past 100 conversations
 * this wants the keyset the timeline already has.
 */
export async function fetchConversations(
  supabase: SupabaseClient<Database>,
  viewerId: string,
): Promise<Thread[]> {
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(LIST_LIMIT);

  return withPeople(supabase, data ?? [], viewerId);
}

/** One conversation by id, or null when there is no such conversation for this viewer. */
export async function fetchConversation(
  supabase: SupabaseClient<Database>,
  id: string,
  viewerId: string,
): Promise<Thread | null> {
  const { data } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return (await withPeople(supabase, [data], viewerId))[0] ?? null;
}

/**
 * The conversation with one particular person, if there is one. What the Message
 * button on a profile asks before it decides whether to open a conversation or a
 * blank one -- a conversation is made by its first message, never before.
 */
export async function findConversationWith(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  personId: string,
): Promise<Conversation | null> {
  const [a, b] = pair(viewerId, personId);
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("a", a)
    .eq("b", b)
    .maybeSingle();
  return data ?? null;
}

/** The newest MESSAGE_LIMIT messages of one conversation, oldest first: reading order. */
export async function fetchMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    // Newest first is what the limit has to cut, and the id settles a tie
    // between two messages written in the same instant.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGE_LIMIT);

  return (data ?? []).reverse();
}

/** Attach the other person to each conversation, in one round trip for the lot. */
async function withPeople(
  supabase: SupabaseClient<Database>,
  rows: Conversation[],
  viewerId: string,
): Promise<Thread[]> {
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((c) => otherId(c, viewerId)))];
  const { data: people } = await supabase.from("profiles").select("*").in("id", ids);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return rows
    .slice()
    .sort(byNewest)
    .flatMap((conversation) => {
      const other = byId.get(otherId(conversation, viewerId));
      // A profile goes when its account does, and the conversation cascades with
      // it, so this only drops a row in the instant between the two.
      return other ? [{ conversation, other }] : [];
    });
}
