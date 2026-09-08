import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { searchPeels, searchPeople } from "@/lib/peels";
import { Column } from "@/components/column";
import { EmptyState } from "@/components/empty-state";
import { FeedShell } from "@/components/feed-shell";
import { PeelList } from "@/components/peel-list";
import { PersonList } from "@/components/person-list";
import { parseResultTab, ResultTabs } from "@/components/result-tabs";
import { SearchForm } from "@/components/search-form";
import { Trending } from "@/components/trending";
import { WhoToFollow } from "@/components/who-to-follow";

export const metadata: Metadata = { title: "Explore" };

const PEEL_LIMIT = 30;
const PEOPLE_LIMIT = 20;
const SUGGESTIONS = 8;
const TRENDS = 5;

export default async function Explore({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Search is how a reader without an account finds anybody at all, so it is
  // open; only the suggestions below it are about somebody in particular.
  const viewerId = user?.id ?? null;

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const tab = parseResultTab(params.tab);

  // One tab is on screen, so one tab is read: peels and people are different
  // queries against different tables, and neither is cheap enough to run for a
  // panel nobody asked for. The two that do not apply resolve to nothing.
  const [viewer, peels, people] = await Promise.all([
    user ? supabase.from("profiles").select("username").eq("id", user.id).maybeSingle() : null,
    q !== "" && tab !== "people"
      ? searchPeels(supabase, viewerId, q, tab === "top", PEEL_LIMIT)
      : Promise.resolve([]),
    q !== "" && tab === "people"
      ? searchPeople(supabase, viewerId, q, PEOPLE_LIMIT)
      : Promise.resolve([]),
  ]);

  return (
    <FeedShell username={viewer === null ? null : (viewer.data?.username ?? "")}>
      <Column>
        <SearchForm q={q} />

        {q === "" ? (
          /* Nothing searched for yet: the day's tags, then people to follow --
             the two ways in that do not need the reader to know a word first. */
          <>
            <Trending n={TRENDS} />
            {/* Suggestions are people the viewer does not follow yet, which is
                not a question a signed-out reader has an answer to. */}
            {viewerId && <WhoToFollow viewerId={viewerId} n={SUGGESTIONS} />}
          </>
        ) : (
          <>
            <ResultTabs q={q} tab={tab} />

            {/* Top and Latest match exactly the same peels and differ only in
                order, so they share an empty state: if one has nothing, neither
                does, and pointing at the other tab would be a dead end. */}
            {tab === "people" ? (
              people.length === 0 ? (
                <EmptyState title="Nobody by that name" body="Try a handle, or part of one." />
              ) : (
                <PersonList people={people} signedIn={user !== null} />
              )
            ) : (
              <PeelList
                peels={peels}
                viewerId={viewerId}
                live={false}
                emptyTitle="No peels match"
                emptyBody="Try another word, or look under People."
              />
            )}
          </>
        )}
      </Column>
    </FeedShell>
  );
}
