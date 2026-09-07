// Everyone the viewer has muted, and the way to undo it. The follower list with
// a different button on each row -- so it pages the same way and looks the same,
// and there is one list component rather than two.
import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { PersonList } from "@/components/person-list";
import { ShowOlder } from "@/components/show-older";
import { UnmuteButton } from "@/components/unmute-button";
import { fetchMutedList } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../../tokens.stylex";

export const metadata: Metadata = { title: "Muted" };

export default async function Muted({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ people, older }, { data: profile }] = await Promise.all([
    fetchMutedList(supabase, user.id, before),
    supabase.from("profiles").select("username").eq("id", user.id).single(),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username}>
      <Column>
        <Link
          href="/settings"
          {...stylex.props(
            buttonStyles.base,
            buttonStyles.variants.tertiary,
            buttonStyles.sizes.sm,
            styles.back,
          )}
        >
          <ArrowLeftIcon />
          Settings
        </Link>

        <h1 {...stylex.props(styles.heading)}>Muted</h1>

        {people.length > 0 ? (
          <PersonList
            people={people}
            action={(person) => (
              <UnmuteButton profileId={person.profile.id} handle={person.profile.username} />
            )}
          />
        ) : (
          <EmptyState
            title={before ? "That's everyone." : "Nobody muted"}
            body={
              before
                ? "You've reached the end."
                : "Mute someone from the dots on their profile and they turn up here."
            }
          />
        )}

        {older && (
          <ShowOlder
            href={`/settings/muted?before=${encodeURIComponent(older)}`}
            label="Show more people"
          />
        )}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  back: { alignSelf: "flex-start", paddingInline: 0 },
  heading: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.625rem",
    lineHeight: 1.15,
    color: colors.burnt,
  },
});
