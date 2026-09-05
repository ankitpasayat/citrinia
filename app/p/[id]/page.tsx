import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Band } from "@/components/band";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { PeelList } from "@/components/peel-list";
import { ReplyComposer } from "@/components/reply-composer";
import { fetchPeel, fetchPeels } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Peel" };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const peel = await fetchPeel(supabase, user.id, id);
  if (!peel) notFound();

  const [{ data: profile }, replies] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    // Replies read oldest first: a thread is a conversation, not a feed.
    fetchPeels(supabase, user.id, { parentId: id, ascending: true }),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username}>
      <Column>
        <Band slim />
        <Link
          href="/"
          {...stylex.props(
            buttonStyles.base,
            buttonStyles.variants.tertiary,
            buttonStyles.sizes.sm,
            styles.back,
          )}
        >
          <ArrowLeftIcon />
          Feed
        </Link>

        {/* One card, no channel: the replies list below already refreshes the route. */}
        <PeelList peels={[peel]} viewerId={user.id} live={false} />

        <ReplyComposer parentId={peel.id} replyingTo={peel.author.username} />

        <PeelList
          peels={replies}
          viewerId={user.id}
          emptyTitle="No replies yet"
          emptyBody="Be the first."
        />
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  back: { alignSelf: "flex-start", paddingInline: 0 },
});
