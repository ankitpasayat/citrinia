import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { PeelList } from "@/components/peel-list";
import { ProfileCard } from "@/components/profile-card";
import { ProfileTabs, parseProfileTab, type ProfileTab } from "@/components/profile-tabs";
import { ShowOlder } from "@/components/show-older";
import { PAGE_SIZE, encodeCursor, fetchLikedBy, fetchPeels, fetchRepliesBy } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
};

/** Title, and the copy for a tab that has nothing in it yet. */
const EMPTY: Record<ProfileTab, { title: string; self: string; other: string }> = {
  peels: { title: "No peels yet", self: "Tap + to peel first.", other: "Nothing peeled yet." },
  replies: {
    title: "No replies yet",
    self: "Reply to a peel and it lands here.",
    other: "Nothing to say so far.",
  },
  likes: {
    title: "No likes yet",
    self: "Tap the wedge on a peel you like.",
    other: "Nothing liked yet.",
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const supabase = await createClient();
  // Metadata resolves before the page's redirect; keep names out of titles for logged-out requests.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { title: "Citrinia" };
  const { data } = await supabase
    .from("profiles")
    .select("name, username")
    .eq("username", username)
    .maybeSingle();

  return data ? { title: `${data.name} (@${data.username})` } : { title: "Not found" };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  const { tab: rawTab, before } = await searchParams;
  const tab = parseProfileTab(rawTab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .maybeSingle();
  if (!profile) notFound();

  const isSelf = profile.id === user.id;

  // Counts are head requests, so nothing but the number crosses the wire.
  const [peelCount, followers, following, follow, peels, viewer] = await Promise.all([
    supabase
      .from("peels")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .is("parent_id", null),
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", profile.id),
    supabase.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", profile.id),
    supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", user.id)
      .eq("followee_id", profile.id)
      .maybeSingle(),
    tab === "replies"
      ? fetchRepliesBy(supabase, user.id, profile.id, before)
      : tab === "likes"
        ? fetchLikedBy(supabase, user.id, profile.id, before)
        : fetchPeels(supabase, user.id, {
            authorId: profile.id,
            parentId: null,
            before,
            limit: PAGE_SIZE,
          }),
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
  ]);

  const older = peels.length === PAGE_SIZE ? await cursor(supabase, tab, profile.id, peels) : null;
  const empty = EMPTY[tab];

  return (
    <FeedShell username={isSelf ? profile.username : (viewer.data?.username ?? "")}>
      <Column>
        <ProfileCard
          profile={profile}
          counts={{
            peels: peelCount.count ?? 0,
            followers: followers.count ?? 0,
            following: following.count ?? 0,
          }}
          isSelf={isSelf}
          isFollowing={follow.data !== null}
        />

        <ProfileTabs username={profile.username} tab={tab} />

        <PeelList
          peels={peels}
          viewerId={user.id}
          live={false}
          // Past the first page an empty tab is the end of it, not an empty tab.
          emptyTitle={before ? "That's all the peels." : empty.title}
          emptyBody={
            before ? "You've reached the end." : isSelf ? empty.self : empty.other
          }
        />

        {older && (
          <ShowOlder
            href={`/u/${encodeURIComponent(profile.username)}?tab=${tab}&before=${encodeURIComponent(older)}`}
          />
        )}
      </Column>
    </FeedShell>
  );
}

/**
 * Where the next page starts. Peels and replies page on the peel's own clock, but
 * Likes is ordered by when the like happened and the peels it returns do not carry
 * that -- so read the last row's like back to get it.
 */
async function cursor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tab: ProfileTab,
  profileId: string,
  peels: PeelUnionAuthor[],
): Promise<string | null> {
  const last = peels[peels.length - 1];
  if (tab !== "likes") return encodeCursor(last.created_at, last.id);

  const { data } = await supabase
    .from("likes")
    .select("created_at")
    .eq("user_id", profileId)
    .eq("peel_id", last.id)
    .maybeSingle();
  return data ? encodeCursor(data.created_at, last.id) : null;
}
