import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPeels } from "@/lib/peels";
import { Band } from "@/components/band";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { PeelList } from "@/components/peel-list";
import { ProfileCard } from "@/components/profile-card";

type Props = { params: Promise<{ username: string }> };

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

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
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
    fetchPeels(supabase, user.id, { authorId: profile.id, parentId: null }),
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <FeedShell username={isSelf ? profile.username : (viewer.data?.username ?? "")}>
      <Column>
        <Band slim />
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
        <PeelList
          peels={peels}
          viewerId={user.id}
          emptyTitle="No peels yet"
          emptyBody={isSelf ? "Tap + to peel first." : "Nothing peeled yet."}
        />
      </Column>
    </FeedShell>
  );
}
