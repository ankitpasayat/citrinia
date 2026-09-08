import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { colors } from "@/app/tokens.stylex";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { PeelList } from "@/components/peel-list";
import { ReplyComposer } from "@/components/reply-composer";
import { fetchAncestors, fetchMutedIds, fetchPeel, fetchPeels } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Peel" };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A peel is a public thing to have said: no session reads it just the same,
  // and the composer below is the one part of the page that needs one.
  const viewerId = user?.id ?? null;

  // The mutes come along for the ride: the replies below need them, and nothing
  // above depends on them. Signed out there are none, and no query for them.
  const [peel, muted] = await Promise.all([
    fetchPeel(supabase, viewerId, id),
    fetchMutedIds(supabase, viewerId),
  ]);
  if (!peel) notFound();

  const [{ data: profile }, ancestors, replies] = await Promise.all([
    user ? supabase.from("profiles").select("username").eq("id", user.id).single() : { data: null },
    // What this peel answers, root first, so the page reads top to bottom. Not
    // muted-filtered: a gap in the middle of a conversation is worse than seeing
    // one peel from somebody quiet, and the reader came here on purpose.
    fetchAncestors(supabase, viewerId, id),
    // Replies read oldest first: a thread is a conversation, not a feed.
    // A muted person's reply is hidden here and nowhere else -- it is still
    // under the peel for everybody else, and still on their own profile.
    fetchPeels(supabase, viewerId, { parentId: id, ascending: true, excludeAuthorIds: muted }),
  ]);
  if (user && !profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile?.username ?? null}>
      <Column>
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

        {/* The conversation this peel is part of, above it. Context, so no
            channel and no `embed`: the peel that was opened is the one that plays. */}
        {ancestors.length > 0 && (
          <div {...stylex.props(styles.chain)}>
            <PeelList peels={ancestors} viewerId={viewerId} live={false} />
          </div>
        )}

        {/* One card, no channel: the replies list below is the one that listens.
            `embed` is what makes a YouTube link play here instead of linking here. */}
        <PeelList peels={[peel]} viewerId={viewerId} live={false} embed />

        {/* The composer's slot, for a reader who has nothing to say with yet. */}
        {profile ? (
          <ReplyComposer parentId={peel.id} replyingTo={peel.author.username} />
        ) : (
          <Link
            href="/login"
            {...stylex.props(
              buttonStyles.base,
              buttonStyles.variants.secondary,
              styles.signIn,
            )}
          >
            Sign in to reply
          </Link>
        )}

        <PeelList
          peels={replies}
          viewerId={viewerId}
          live={{ parentId: id }}
          emptyTitle="No replies yet"
          emptyBody="Be the first."
        />
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  back: { alignSelf: "flex-start", paddingInline: 0 },
  signIn: { alignSelf: "flex-start" },
  // The thread line: one rule down the avatar column, behind the cards, so all
  // that shows is a segment joining each avatar to the next -- which is what
  // says "these are one conversation" rather than "these are a feed".
  chain: {
    position: "relative",
    // The line is painted behind its own cards, and `position: relative` alone
    // would leave it in the page's stacking context, i.e. behind the background.
    isolation: "isolate",
    "::before": {
      content: "''",
      position: "absolute",
      // The avatar column's centre: a card's 16px of padding, half a 40px avatar.
      left: 35,
      width: 2,
      // From the first avatar's centre to the top of the peel being answered,
      // one gap below the last ancestor (Column and PeelList both space by 12).
      top: 36,
      bottom: -12,
      backgroundColor: colors.apricot,
      zIndex: -1,
    },
  },
});
