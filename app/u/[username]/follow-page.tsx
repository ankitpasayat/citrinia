// Followers, and following. Two routes over one page: the same back link, the
// same segmented control and the same list of people -- only the side changes,
// so `/u/ada/followers` and `/u/ada/following` are each a dozen lines.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { PersonList } from "@/components/person-list";
import { Segmented } from "@/components/segmented";
import { ShowOlder } from "@/components/show-older";
import { fetchFollowList, resolveHandle, type FollowSide } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

/** The copy for a side with nobody on it, read about yourself or about somebody else. */
const EMPTY: Record<FollowSide, { title: string; self: string; other: string }> = {
  followers: {
    title: "No followers yet",
    self: "Peel something, and people will find you.",
    other: "Nobody follows them yet.",
  },
  following: {
    title: "Not following anyone",
    self: "Follow someone and their peels land in your feed.",
    other: "They haven't followed anyone yet.",
  },
};

export async function FollowPage({
  username,
  side,
  before,
}: {
  username: string;
  side: FollowSide;
  before?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Who follows whom is public; only the button at the end of each row is not.
  const viewerId = user?.id ?? null;

  const found = await resolveHandle(supabase, username);
  if (!found) notFound();
  // An old handle forwards here too, onto the same side of the same list.
  if ("movedTo" in found) redirect(`/u/${encodeURIComponent(found.movedTo)}/${side}`);
  const profile = found.profile;

  const [{ people, older }, viewer] = await Promise.all([
    fetchFollowList(supabase, viewerId, profile.id, side, before),
    user ? supabase.from("profiles").select("username").eq("id", user.id).maybeSingle() : null,
  ]);

  const base = `/u/${encodeURIComponent(profile.username)}`;
  const isSelf = profile.id === viewerId;
  const empty = EMPTY[side];
  // The reader's own handle, for the rail's You; null is a signed-out reader.
  const me = viewer === null ? null : (isSelf ? profile.username : (viewer.data?.username ?? ""));

  return (
    <FeedShell username={me}>
      <Column>
        {/* Back to the profile this list belongs to, named, so it is clear whose it is. */}
        <Link
          href={base}
          {...stylex.props(
            buttonStyles.base,
            buttonStyles.variants.tertiary,
            buttonStyles.sizes.sm,
            styles.back,
          )}
        >
          <ArrowLeftIcon />
          {profile.name}
        </Link>

        <Segmented
          label="Follows"
          segments={[
            { href: `${base}/followers`, label: "Followers", current: side === "followers" },
            { href: `${base}/following`, label: "Following", current: side === "following" },
          ]}
        />

        {people.length > 0 ? (
          <PersonList people={people} signedIn={user !== null} />
        ) : (
          <EmptyState
            // Past the first page an empty side is the end of it, not an empty side.
            title={before ? "That's everyone." : empty.title}
            body={before ? "You've reached the end." : isSelf ? empty.self : empty.other}
          />
        )}

        {older && (
          <ShowOlder
            href={`${base}/${side}?before=${encodeURIComponent(older)}`}
            label="Show more people"
          />
        )}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  back: { alignSelf: "flex-start", paddingInline: 0 },
});
