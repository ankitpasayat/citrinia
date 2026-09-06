import type { Metadata } from "next";
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { escapeRegex, fetchPeels } from "@/lib/peels";
import { Avatar } from "@/components/avatar";
import { Band } from "@/components/band";
import { Column } from "@/components/column";
import { FeedShell } from "@/components/feed-shell";
import { PeelList } from "@/components/peel-list";
import { SearchForm } from "@/components/search-form";
import { WhoToFollow } from "@/components/who-to-follow";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

export const metadata: Metadata = { title: "Search" };

const PEEL_LIMIT = 30;
const PEOPLE_LIMIT = 10;
const SUGGESTIONS = 8;

/**
 * `q` is user text, not a pattern: escape the regex metacharacters, then wrap the
 * whole value in PostgREST's double quotes so a comma or a parenthesis cannot
 * break out of the `or=(…)` logic tree. Verified against the live REST endpoint:
 * the quoted form parses, the bare one answers 400 PGRST100.
 *
 * `imatch` (`~*`), not `ilike`: PostgREST rewrites every `*` in a like/ilike
 * operand to `%` and offers no escape for it, so `ilike."%*%"` returns every
 * profile. `imatch` is the same case-insensitive substring match, unrewritten.
 */
function searchFilter(q: string): string {
  const quoted = `"${escapeRegex(q).replace(/["\\]/g, (c) => `\\${c}`)}"`;
  return `username.imatch.${quoted},name.imatch.${quoted}`;
}

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const q = ((await searchParams).q ?? "").trim();

  const [{ data: viewer }, { data: people }, peels] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    q === ""
      ? Promise.resolve({ data: [] as Pick<Profile, "id" | "name" | "username" | "avatar_url">[] })
      : supabase
          .from("profiles")
          .select("id, name, username, avatar_url")
          .or(searchFilter(q))
          .limit(PEOPLE_LIMIT),
    q === "" ? Promise.resolve([]) : fetchPeels(supabase, user.id, { search: q, limit: PEEL_LIMIT }),
  ]);

  return (
    <FeedShell username={viewer?.username ?? ""}>
      <Column>
        <Band slim />
        <SearchForm q={q} />

        {q === "" ? (
          /* Nothing to search for yet: offer people instead of an empty block. */
          <WhoToFollow viewerId={user.id} n={SUGGESTIONS} />
        ) : (
          <>
            {people && people.length > 0 && (
              <section {...stylex.props(styles.section)}>
                <h2 {...stylex.props(styles.label)}>People</h2>
                <div {...stylex.props(styles.people)}>
                  {people.map((person) => (
                    <Link key={person.id} href={`/u/${person.username}`} {...stylex.props(styles.row)}>
                      <Avatar src={person.avatar_url} name={person.name} size="sm" />
                      <span {...stylex.props(styles.rowText)}>
                        <b {...stylex.props(styles.rowName)}>{person.name}</b>
                        <span {...stylex.props(styles.rowHandle)}>@{person.username}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section {...stylex.props(styles.section)}>
              <h2 {...stylex.props(styles.label)}>Peels</h2>
              <PeelList
                peels={peels}
                viewerId={user.id}
                live={false}
                emptyTitle="No peels match"
                emptyBody="Try another word."
              />
            </section>
          </>
        )}
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: 10 },
  label: {
    margin: 0,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: colors.burnt,
  },
  people: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 8,
    paddingInline: 8,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingBlock: 7,
    paddingInline: 8,
    borderRadius: 16,
    textDecorationLine: "none",
    backgroundColor: {
      default: "transparent",
      [bp.hover]: { default: "transparent", ":hover": colors.chip },
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -1,
  },
  rowText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  rowName: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: 1.2,
    color: colors.burnt,
    overflowWrap: "anywhere",
  },
  rowHandle: { fontSize: "0.8125rem", fontWeight: 700, color: colors.muted, overflowWrap: "anywhere" },
});
