import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Band } from "@/components/band";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { NotificationList } from "@/components/notification-list";
import { fetchNotifications } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../tokens.stylex";

export const metadata: Metadata = { title: "Notifications" };

/** One screenful. Older notifications age out rather than paginate. */
const LIMIT = 50;

export default async function Notifications() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, items] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    fetchNotifications(supabase, user.id, LIMIT),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username}>
      <Column>
        <Band slim />
        <h1 {...stylex.props(styles.heading)}>Notifications</h1>

        {items.length === 0 ? (
          <EmptyState title="Nothing yet" body="Likes, replies, follows and mentions land here." />
        ) : (
          <NotificationList items={items} />
        )}
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
