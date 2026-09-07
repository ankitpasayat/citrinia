import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Conversation } from "@/components/conversation";
import { ConversationHead } from "@/components/conversation-head";
import { findConversationWith } from "@/lib/conversations";
import { resolveHandle } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ username: string }> };

export const metadata: Metadata = { title: "Messages" };

/**
 * A conversation with one person, whether or not there is one yet. Both ways in
 * -- the Message button on a profile and the picker at /messages/new -- come
 * here, because neither of them knows whether these two have ever spoken and
 * neither should have to: a conversation is made by its first message, so the
 * one that exists is a redirect and the one that does not is a blank screen with
 * a composer.
 */
export default async function ConversationWith({ params }: Props) {
  const { username } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const found = await resolveHandle(supabase, decodeURIComponent(username));
  if (!found) notFound();
  // An old handle still finds them, the way it does everywhere else.
  if ("movedTo" in found) redirect(`/messages/with/${encodeURIComponent(found.movedTo)}`);

  const other = found.profile;
  // Nobody messages themselves; send_message() refuses it too.
  if (other.id === user.id) redirect("/messages");

  const existing = await findConversationWith(supabase, user.id, other.id);
  if (existing) redirect(`/messages/${existing.id}`);

  return (
    <>
      <ConversationHead other={other} />
      <Conversation viewerId={user.id} other={other} conversationId={null} messages={[]} />
    </>
  );
}
