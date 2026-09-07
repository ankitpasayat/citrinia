// Muted, and blocked. Two routes over one page: the same back link, the same
// heading and the same list of people -- only which list is read and which
// button ends each row changes, so /settings/muted and /settings/blocked are
// each a dozen lines. The follower pages are built the same way.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BlockButton } from "@/components/block-button";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { PersonList } from "@/components/person-list";
import { ShowOlder } from "@/components/show-older";
import { UnmuteButton } from "@/components/unmute-button";
import { fetchBlockedList, fetchMutedList } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../tokens.stylex";

export type PeopleListKind = "muted" | "blocked";

/** The copy for a list with nobody on it. */
const EMPTY: Record<PeopleListKind, { title: string; body: string }> = {
  muted: {
    title: "Nobody muted",
    body: "Mute someone from the dots on their profile and they turn up here.",
  },
  blocked: {
    title: "Nobody blocked",
    body: "Block someone from the dots on their profile and they turn up here.",
  },
};

const HEADING: Record<PeopleListKind, string> = { muted: "Muted", blocked: "Blocked" };

export async function PeoplePage({
  kind,
  before,
}: {
  kind: PeopleListKind;
  before?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const read = kind === "muted" ? fetchMutedList : fetchBlockedList;
  const [{ people, older }, { data: profile }] = await Promise.all([
    read(supabase, user.id, before),
    supabase.from("profiles").select("username").eq("id", user.id).single(),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  const empty = EMPTY[kind];

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

        <h1 {...stylex.props(styles.heading)}>{HEADING[kind]}</h1>

        {people.length > 0 ? (
          <PersonList
            people={people}
            action={(person) =>
              kind === "muted" ? (
                <UnmuteButton profileId={person.profile.id} handle={person.profile.username} />
              ) : (
                <BlockButton
                  profileId={person.profile.id}
                  handle={person.profile.username}
                  isBlocked
                  compact
                />
              )
            }
          />
        ) : (
          <EmptyState
            // Past the first page an empty list is the end of it, not an empty list.
            title={before ? "That's everyone." : empty.title}
            body={before ? "You've reached the end." : empty.body}
          />
        )}

        {older && (
          <ShowOlder
            href={`/settings/${kind}?before=${encodeURIComponent(older)}`}
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
