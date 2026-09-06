import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { Band } from "@/components/band";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { SearchIcon } from "@/components/icons";
import { PeelList } from "@/components/peel-list";
import { LivePill } from "@/components/pill";
import { TimelineToggle } from "@/components/timeline-toggle";
import { WhoToFollow } from "@/components/who-to-follow";
import { fetchTimeline } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "./tokens.stylex";

export const metadata: Metadata = { title: "Feed" };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  // The signup trigger creates this row; without it there is no app to show.
  if (!profile) throw new Error("No profile for the signed-in user.");

  const { tab, before } = await searchParams;
  const following = tab === "following";

  // home_timeline merges peels and repeels onto one clock; your own peels are
  // always in Following, so it is never empty once you post.
  const [{ items, nextBefore }, follows] = await Promise.all([
    fetchTimeline(supabase, user.id, { followingOnly: following, before }),
    // Following a handful of people is not a full feed yet, so keep suggesting --
    // an empty list is not the only time somebody needs them.
    following
      ? supabase
          .from("follows")
          .select("followee_id", { count: "exact", head: true })
          .eq("follower_id", user.id)
      : null,
  ]);
  const suggest = following && (follows?.count ?? 0) < 3;
  const olderHref =
    nextBefore === null
      ? null
      : `/?${following ? "tab=following&" : ""}before=${encodeURIComponent(nextBefore)}`;

  return (
    <FeedShell username={profile.username}>
      <Column>
        <Band>
          <Link
            href="/search"
            aria-label="Search"
            {...stylex.props(buttonStyles.base, buttonStyles.variants.icon, styles.bandIcon)}
          >
            <SearchIcon />
          </Link>
          <LivePill />
          <AccountMenu profile={profile} />
        </Band>

        <p {...stylex.props(styles.greet)}>
          Hi {profile.name},{" "}
          <span {...stylex.props(styles.accent)}>how are you peeling?</span>
        </p>

        <TimelineToggle tab={tab} />

        <PeelList
          peels={items}
          viewerId={user.id}
          live={{ parentId: null }}
          // Past the first page an empty list is the end of the feed, not a first run.
          emptyTitle={before ? "That's all the peels." : undefined}
          emptyBody={
            before
              ? "You've reached the end."
              : following
                ? "Follow people to fill this up."
                : "Tap + to peel first."
          }
          olderHref={olderHref}
        />

        {suggest && <WhoToFollow viewerId={user.id} n={5} />}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  // Cocoa reads on every stripe; the icon variant's muted grey does not.
  bandIcon: { color: colors.onStripe },
  greet: { margin: 0, fontWeight: 800, color: colors.muted },
  accent: { fontFamily: fonts.display, fontWeight: 400, fontSize: "1.375rem", color: colors.burnt },
});
