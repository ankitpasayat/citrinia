import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Column } from "@/components/column";
import { Conversation } from "@/components/conversation";
import { ConversationHead } from "@/components/conversation-head";
import { FeedShell } from "@/components/feed-shell";
import { fetchConversation, fetchMessages } from "@/lib/conversations";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Messages" };

export default async function OneConversation({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // A malformed id is a 404 rather than a database error about uuid syntax.
  if (!UUID.test(id)) notFound();

  const [{ data: profile }, thread] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    fetchConversation(supabase, id, user.id),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");
  // RLS answers with nothing for a conversation somebody is not in, so "not
  // yours" and "not there" are the same 404 -- which is the only answer that
  // does not tell a stranger a conversation exists.
  if (!thread) notFound();

  const messages = await fetchMessages(supabase, thread.conversation.id);

  return (
    <FeedShell username={profile.username}>
      {/* No bar to clear: the composer sits on the bottom edge. */}
      <Column withTabs={false}>
        <ConversationHead other={thread.other} />
        <Conversation
          // Opening another conversation is a fresh screen, not this one handed
          // somebody else's messages.
          key={thread.conversation.id}
          viewerId={user.id}
          other={thread.other}
          conversationId={thread.conversation.id}
          messages={messages}
        />
      </Column>
    </FeedShell>
  );
}
