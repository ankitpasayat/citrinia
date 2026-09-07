import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { PlusIcon } from "@/components/icons";
import { RequestActions } from "@/components/request-actions";
import { Segmented } from "@/components/segmented";
import { fetchConversations } from "@/lib/conversations";
import { isRequest } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts, shape } from "../tokens.stylex";

type Props = { searchParams: Promise<{ tab?: string }> };

export const metadata: Metadata = { title: "Messages" };

export default async function Messages({ searchParams }: Props) {
  const { tab } = await searchParams;
  // Anything that is not a tab name is the inbox, so a hand-edited URL still renders.
  const onRequests = tab === "requests";

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

  // One read, split by the same rule the badge counts by. A request is only ever
  // a request to the person who did not start it.
  const requests = threads.filter((t) => isRequest(t.conversation, user.id));
  const inbox = threads.filter((t) => !isRequest(t.conversation, user.id));
  const shown = onRequests ? requests : inbox;

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

        {/* The tab only appears once there is something behind it: an empty
            Requests tab is a door onto a cupboard. */}
        {requests.length > 0 && (
          <Segmented
            label="Messages"
            segments={[
              { href: "/messages", label: "Inbox", current: !onRequests },
              {
                href: "/messages?tab=requests",
                // A dot, not a number: what matters is that somebody is waiting,
                // and counting them here would be a second badge in the app.
                label: (
                  <>
                    Requests
                    <span
                      role="img"
                      aria-label="Waiting"
                      {...stylex.props(styles.dot, onRequests && styles.dotOn)}
                    />
                  </>
                ),
                current: onRequests,
              },
            ]}
          />
        )}

        {shown.length === 0 ? (
          onRequests ? (
            <EmptyState title="No requests" body="Messages from people you don't follow wait here." />
          ) : (
            <EmptyState
              title="No messages yet"
              body="Say hello to somebody. Their profile has a Message button, or tap + to find them."
            />
          )
        ) : (
          <ConversationList
            threads={shown}
            viewerId={user.id}
            action={
              onRequests
                ? ({ conversation, other }) => (
                    <RequestActions
                      conversationId={conversation.id}
                      profileId={other.id}
                      handle={other.username}
                    />
                  )
                : undefined
            }
          />
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
  dot: {
    display: "inline-block",
    width: 7,
    height: 7,
    marginInlineStart: 6,
    borderRadius: shape.pill,
    backgroundColor: colors.burnt,
  },
  // On the selected segment the pill is already burnt, so the dot takes the
  // segment's own colour to stay visible on it.
  dotOn: { backgroundColor: colors.onButton },
});
