import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Conversation } from "@/components/conversation";
import { ConversationHead } from "@/components/conversation-head";
import { RequestBanner } from "@/components/request-banner";
import { fetchConversation, fetchMessages } from "@/lib/conversations";
import { isRequest } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Messages" };

/** One open conversation. The shell and the list beside it are the layout's. */
export default async function OneConversation({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // A malformed id is a 404 rather than a database error about uuid syntax.
  if (!UUID.test(id)) notFound();

  const thread = await fetchConversation(supabase, id, user.id);
  // RLS answers with nothing for a conversation somebody is not in, so "not
  // yours" and "not there" are the same 404 -- which is the only answer that
  // does not tell a stranger a conversation exists.
  if (!thread) notFound();

  const messages = await fetchMessages(supabase, thread.conversation.id);

  return (
    <>
      <ConversationHead other={thread.other} />
      {/* A request opened from the Requests tab keeps its three answers here, so
          the choice does not mean going back for it. */}
      {isRequest(thread.conversation, user.id) && (
        <RequestBanner conversationId={thread.conversation.id} other={thread.other} />
      )}
      <Conversation
        // Opening another conversation is a fresh screen, not this one handed
        // somebody else's messages -- which matters in the split view, where the
        // component would otherwise be reused across the navigation.
        key={thread.conversation.id}
        viewerId={user.id}
        other={thread.other}
        conversationId={thread.conversation.id}
        messages={messages}
      />
    </>
  );
}
