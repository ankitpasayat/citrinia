// Suggestions: people the viewer does not follow yet, most-followed first. A
// server component with its own client, so any screen can drop it in without
// threading a Supabase client or a query through its props. Renders nothing when
// there is nobody left to suggest, so a caller never has to check first.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { fetchSuggestedProfiles } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";

export async function WhoToFollow({ viewerId, n = 5 }: { viewerId: string; n?: number }) {
  const supabase = await createClient();
  const people = await fetchSuggestedProfiles(supabase, viewerId, n);
  if (people.length === 0) return null;

  return (
    <section {...stylex.props(styles.card)}>
      <h2 {...stylex.props(styles.label)}>Who to follow</h2>

      {people.map((person) => (
        <div key={person.id} {...stylex.props(styles.row)}>
          <Link href={`/u/${person.username}`} {...stylex.props(styles.who)}>
            <Avatar src={person.avatar_url} name={person.name} size="sm" />
            <span {...stylex.props(styles.text)}>
              <b {...stylex.props(styles.name)}>{person.name}</b>
              <span {...stylex.props(styles.handle)}>@{person.username}</span>
              {/* One line of bio: the rest belongs on their profile. */}
              {person.bio !== "" && (
                <span {...stylex.props(styles.bio)}>{person.bio.split("\n")[0]}</span>
              )}
            </span>
          </Link>
          {/* Suggestions are never followed yet, but the button owns that state after a tap. */}
          <FollowButton profileId={person.id} isFollowing={false} compact />
        </div>
      ))}
    </section>
  );
}

const styles = stylex.create({
  card: {
    display: "grid",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 16,
    paddingInline: 16,
  },
  label: {
    margin: 0,
    marginBottom: 4,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: colors.burnt,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
  },
  who: {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    minWidth: 0,
    minHeight: 44,
    paddingBlock: 6,
    textDecorationLine: "none",
    borderRadius: 14,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
  },
  text: { display: "grid", gap: 2, minWidth: 0 },
  name: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: 1.2,
    color: colors.burnt,
    overflowWrap: "anywhere",
  },
  handle: { fontSize: "0.8125rem", fontWeight: 700, color: colors.muted, overflowWrap: "anywhere" },
  bio: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    lineHeight: 1.35,
    color: colors.muted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});
