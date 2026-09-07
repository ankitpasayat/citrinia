import { redirect } from "next/navigation";
import { ConversationPanel } from "@/components/conversation-panel";
import { FeedShell } from "@/components/feed-shell";
import { MessagesShell } from "@/components/messages-shell";
import { fetchConversations } from "@/lib/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * Every messages screen: the list on one side, whatever is open on the other.
 *
 * The list is read here rather than in each page so that moving between
 * conversations does not re-render it -- which is what makes the split view feel
 * like one screen with two halves rather than two screens taking turns. A layout
 * is also the only place that survives a child navigation, so the scroll
 * position of a long list survives with it.
 *
 * `wide` because two panes do not fit in the 520px column, and there is no aside:
 * a search box in a third column beside a conversation is a column of nothing to
 * do.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, threads] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    fetchConversations(supabase, user.id),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username} wide>
      <MessagesShell list={<ConversationPanel threads={threads} viewerId={user.id} />}>
        {children}
      </MessagesShell>
    </FeedShell>
  );
}
