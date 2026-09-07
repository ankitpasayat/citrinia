import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Column } from "@/components/column";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { buttonStyles } from "@/components/button";
import { PlusIcon } from "@/components/icons";
import { fetchConversations } from "@/lib/conversations";
import { isRequest } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../tokens.stylex";

export const metadata: Metadata = { title: "Messages" };

export default async function Messages() {
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

  // Requests are not the inbox; they get their own tab.
  const inbox = threads.filter((t) => !isRequest(t.conversation, user.id));

  return (
    <FeedShell username={profile.username}>
      <Column>
        <div {...stylex.props(styles.head)}>
          <h1 {...stylex.props(styles.heading)}>Messages</h1>
          <Link
            href="/messages/new"
            aria-label="New message"
            {...stylex.props(buttonStyles.base, buttonStyles.variants.icon)}
          >
            <PlusIcon />
          </Link>
        </div>

        {inbox.length === 0 ? (
          <EmptyState
            title="No messages yet"
            body="Say hello to somebody. Their profile has a Message button, or tap + to find them."
          />
        ) : (
          <ConversationList threads={inbox} viewerId={user.id} />
        )}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heading: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.625rem",
    lineHeight: 1.15,
    color: colors.burnt,
  },
});
