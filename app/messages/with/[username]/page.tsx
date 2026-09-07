import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Column } from "@/components/column";
import { Conversation } from "@/components/conversation";
import { ConversationHead } from "@/components/conversation-head";
import { FeedShell } from "@/components/feed-shell";
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

  const [{ data: profile }, existing] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    findConversationWith(supabase, user.id, other.id),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");
  if (existing) redirect(`/messages/${existing.id}`);

  return (
    <FeedShell username={profile.username}>
      {/* No bar to clear: the composer sits on the bottom edge. */}
      <Column withTabs={false}>
        <ConversationHead other={other} />
        <Conversation viewerId={user.id} other={other} conversationId={null} messages={[]} />
      </Column>
    </FeedShell>
  );
}
