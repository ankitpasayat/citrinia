import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { PersonList } from "@/components/person-list";
import { SearchForm } from "@/components/search-form";
import { searchPeople } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { colors, fonts } from "../../tokens.stylex";

type Props = { searchParams: Promise<{ q?: string }> };

export const metadata: Metadata = { title: "New message" };

/**
 * Who to write to. The row still leads to their profile, the way every row of
 * people in this app does; the button beside it is the one that starts talking.
 */
export default async function NewMessage({ searchParams }: Props) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, people] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    term === "" ? Promise.resolve([]) : searchPeople(supabase, user.id, term),
  ]);
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username}>
      <Column>
        <h1 {...stylex.props(styles.heading)}>New message</h1>
        <SearchForm q={term} action="/messages/new" label="Search people" />

        {term === "" ? (
          <EmptyState title="Who are you writing to?" body="Search for them by name or handle." />
        ) : people.length === 0 ? (
          <EmptyState title="Nobody by that name" body={`No people match “${term}”.`} />
        ) : (
          <PersonList
            people={people}
            action={(person) =>
              // Yourself is the one person there is nothing to say to here.
              person.isSelf ? null : (
                <Link
                  href={`/messages/with/${encodeURIComponent(person.profile.username)}`}
                  {...stylex.props(buttonStyles.base, buttonStyles.variants.secondary, buttonStyles.sizes.sm)}
                >
                  Message
                </Link>
              )
            }
          />
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
