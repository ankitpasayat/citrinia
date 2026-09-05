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
import { fetchPeels } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "./tokens.stylex";

export const metadata: Metadata = { title: "Feed" };

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  // The signup trigger creates this row; without it there is no app to show.
  if (!profile) throw new Error("No profile for the signed-in user.");

  const { tab } = await searchParams;
  const following = tab === "following";

  let peels;
  if (following) {
    const { data: follows } = await supabase
      .from("follows")
      .select("followee_id")
      .eq("follower_id", user.id);
    // Your own peels stay in the Following timeline, so it is never empty once you post.
    const authorIds = [...(follows ?? []).map((row) => row.followee_id), user.id];
    peels = await fetchPeels(supabase, user.id, { parentId: null, authorIds, limit: 50 });
  } else {
    peels = await fetchPeels(supabase, user.id, { parentId: null, limit: 50 });
  }

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
          peels={peels}
          viewerId={user.id}
          emptyBody={following ? "Follow people to fill this up." : "Tap + to peel first."}
        />
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
