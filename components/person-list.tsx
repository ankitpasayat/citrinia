// A list of people: avatar, name, handle, one line of bio, and the button that
// says where the viewer stands. Who to follow, a profile's followers and the
// people it follows are all this list, so a new one is a query and nothing more.
// Server-safe; the follow button is the client leaf.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import type { ReactNode } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import type { Person } from "@/lib/peels";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";
import { KindBadge } from "./kind-badge";

type Props = {
  people: Person[];
  heading?: string;
  /**
   * Whether there is somebody doing the following. Only the two lists a reader
   * can reach without an account -- a profile's followers, and the people search
   * -- ever say otherwise; the rest are behind /login already.
   */
  signedIn?: boolean;
  /**
   * What sits at the end of a row, when Follow is not the point of the list --
   * Unmute on /settings/muted. Left out, every row gets the follow button.
   */
  action?: (person: Person) => ReactNode;
};

export function PersonList({ people, heading, signedIn = true, action }: Props) {
  return (
    <section {...stylex.props(styles.card)}>
      {heading && <h2 {...stylex.props(styles.label)}>{heading}</h2>}

      {people.map((person) => (
        <div key={person.profile.id} {...stylex.props(styles.row)}>
          <Link
            href={`/u/${encodeURIComponent(person.profile.username)}`}
            {...stylex.props(styles.who)}
          >
            <Avatar src={person.profile.avatar_url} name={person.profile.name} size="sm" />
            <span {...stylex.props(styles.text)}>
              <b {...stylex.props(styles.name)}>{person.profile.name}</b>
              <span {...stylex.props(styles.handle)}>
                @{person.profile.username} <KindBadge kind={person.profile.kind} />
              </span>
              {/* One line of bio: the rest belongs on their profile. */}
              {person.profile.bio !== "" && (
                <span {...stylex.props(styles.bio)}>{person.profile.bio.split("\n")[0]}</span>
              )}
            </span>
          </Link>
          {/* Nobody follows themselves, so the viewer's own row has no button. */}
          {action
            ? action(person)
            : !person.isSelf && (
                <FollowButton
                  profileId={person.profile.id}
                  isFollowing={person.isFollowing}
                  signedIn={signedIn}
                  compact
                />
              )}
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
