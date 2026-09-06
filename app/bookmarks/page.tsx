import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Band } from "@/components/band";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { PeelList } from "@/components/peel-list";
import { ShowOlder } from "@/components/show-older";
import { PAGE_SIZE, encodeCursor, fetchBookmarks } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../tokens.stylex";

export const metadata: Metadata = { title: "Bookmarks" };

export default async function Bookmarks({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { before } = await searchParams;

  const [{ data: profile }, peels] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    fetchBookmarks(supabase, user.id, before),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  // Bookmarks are ordered by when they were saved, not when the peel was written,
  // and the peels that come back do not carry that timestamp -- so read the last
  // row's own created_at back for the cursor. Only when there is a page to ask for.
  let older: string | null = null;
  if (peels.length === PAGE_SIZE) {
    const { data: cursor } = await supabase
      .from("bookmarks")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("peel_id", peels[peels.length - 1].id)
      .maybeSingle();
    older = cursor ? encodeCursor(cursor.created_at, peels[peels.length - 1].id) : null;
  }

  return (
    <FeedShell username={profile.username}>
      <Column>
        <Band slim />
        <h1 {...stylex.props(styles.heading)}>Bookmarks</h1>

        <PeelList
          peels={peels}
          viewerId={user.id}
          live={false}
          // Past the first page an empty list is the end, not an empty shelf.
          emptyTitle={before ? "That's all the peels." : "No bookmarks yet"}
          emptyBody={
            before ? "You've reached the end." : "Tap the bookmark on a peel to keep it here."
          }
        />

        {older && <ShowOlder href={`/bookmarks?before=${encodeURIComponent(older)}`} />}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  heading: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.625rem",
    lineHeight: 1.15,
    color: colors.burnt,
  },
});
