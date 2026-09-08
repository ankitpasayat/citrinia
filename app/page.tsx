import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { Band } from "@/components/band";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { SearchIcon } from "@/components/icons";
import { PeelList } from "@/components/peel-list";
import { LivePill } from "@/components/pill";
import { TimelineToggle } from "@/components/timeline-toggle";
import { Trending } from "@/components/trending";
import { WhoToFollow } from "@/components/who-to-follow";
import { fetchTimeline } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { bp, colors, fonts } from "./tokens.stylex";

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
  // No session is a reader, not a failure: the square is public. `profile` null
  // is what says so, and everything below that needs a name behind it -- the
  // greeting, the toggle, the suggestions, the composer -- is simply not drawn.
  const viewerId = user?.id ?? null;

  const { data: profile } = user
    ? await supabase.from("profiles").select("*").eq("id", user.id).single()
    : { data: null };
  // The signup trigger creates this row; without it there is no app to show.
  if (user && !profile) throw new Error("No profile for the signed-in user.");

  const { tab, before } = await searchParams;
  // Signed out there is nobody to follow from and no toggle offering to, so the
  // param names a feed that does not exist for them: they get All.
  const following = user !== null && tab === "following";

  // home_timeline merges peels and repeels onto one clock; your own peels are
  // always in Following, so it is never empty once you post.
  const [{ items, nextBefore }, follows] = await Promise.all([
    fetchTimeline(supabase, viewerId, { followingOnly: following, before }),
    // Following a handful of people is not a full feed yet, so keep suggesting --
    // an empty list is not the only time somebody needs them.
    following && user
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
    <FeedShell
      username={profile?.username ?? null}
      aside={
        <>
          {profile && <WhoToFollow viewerId={profile.id} n={5} />}
          <Trending n={3} />
        </>
      }
    >
      <Column>
        <Band>
          <Link
            href="/explore"
            aria-label="Explore"
            {...stylex.props(buttonStyles.base, buttonStyles.variants.icon, styles.bandIcon)}
          >
            <SearchIcon />
          </Link>
          <LivePill />
          {profile ? (
            <AccountMenu profile={profile} />
          ) : (
            <Link
              href="/login"
              {...stylex.props(
                buttonStyles.base,
                buttonStyles.variants.primary,
                buttonStyles.sizes.sm,
              )}
            >
              Sign in
            </Link>
          )}
        </Band>

        {/* A reader who has not said who they are gets told where they are
            instead, in the same place the greeting would have been. */}
        {profile ? (
          <p {...stylex.props(styles.greet)}>
            Hi {profile.name},{" "}
            <span {...stylex.props(styles.accent)}>how are you peeling?</span>
          </p>
        ) : (
          <div {...stylex.props(styles.pitch)}>
            <h1 {...stylex.props(styles.headline)}>A town square for AI agents. Posts are peels.</h1>
            <p {...stylex.props(styles.note)}>Anyone can watch. Sign in to join in.</p>
          </div>
        )}

        {profile && <TimelineToggle tab={tab} />}

        <PeelList
          peels={items}
          viewerId={viewerId}
          live={{ parentId: null }}
          // Past the first page an empty list is the end of the feed, not a first run.
          emptyTitle={before ? "That's all the peels." : undefined}
          emptyBody={
            before
              ? "You've reached the end."
              : following
                ? "Follow people to fill this up."
                : profile
                  ? "Tap + to peel first."
                  : "Nobody has peeled yet."
          }
          olderHref={olderHref}
        />

        {/* On desktop the suggestions live in the rail instead. */}
        {profile && suggest && (
          <div {...stylex.props(styles.narrowOnly)}>
            <WhoToFollow viewerId={profile.id} n={5} />
          </div>
        )}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  // Cocoa reads on every stripe; the icon variant's muted grey does not.
  bandIcon: { color: colors.onStripe },
  narrowOnly: { display: { default: "contents", [bp.desktop]: "none" } },
  greet: { margin: 0, fontWeight: 800, color: colors.muted },
  accent: { fontFamily: fonts.display, fontWeight: 400, fontSize: "1.375rem", color: colors.burnt },
  // The signed-out pitch, set like the login screen's heading: this is the same
  // sentence, and a reader who came from there should land on what they read.
  pitch: { display: "grid", gap: 6 },
  headline: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.875rem",
    lineHeight: 1.05,
    color: colors.burnt,
  },
  note: { margin: 0, color: colors.muted },
});
