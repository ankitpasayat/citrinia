// The head of a profile page: big avatar, name, handle, bio, counts, and the one
// action that belongs to the viewer — follow someone else, or edit and log out
// of your own. Server component; the two interactive bits are client children.
import * as stylex from "@stylexjs/stylex";
import { signOut } from "@/app/actions";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { EditProfileButton } from "./edit-profile-sheet";
import { FollowButton } from "./follow-button";
import { LogOutIcon } from "./icons";

export type ProfileCounts = { peels: number; followers: number; following: number };

type Props = {
  profile: Profile;
  counts: ProfileCounts;
  isSelf: boolean;
  isFollowing: boolean;
};

export function ProfileCard({ profile, counts, isSelf, isFollowing }: Props) {
  // "1 peel", not "1 peels". "following" has no singular to get wrong.
  const items: [number, string][] = [
    [counts.peels, counts.peels === 1 ? "peel" : "peels"],
    [counts.followers, counts.followers === 1 ? "follower" : "followers"],
    [counts.following, "following"],
  ];

  return (
    <section {...stylex.props(styles.card)}>
      <Avatar src={profile.avatar_url} name={profile.name} size="lg" />

      <div>
        <h1 {...stylex.props(styles.name)}>{profile.name}</h1>
        <p {...stylex.props(styles.handle)}>@{profile.username}</p>
        {profile.bio !== "" && <p {...stylex.props(styles.bio)}>{profile.bio}</p>}

        <p {...stylex.props(styles.counts)}>
          {items.map(([n, label], i) => (
            <span key={label} {...stylex.props(styles.count)}>
              {i > 0 && <span {...stylex.props(styles.dot)} aria-hidden="true">·</span>}
              <b {...stylex.props(styles.number)}>{n.toLocaleString("en-US")}</b> {label}
            </span>
          ))}
        </p>
      </div>

      <div {...stylex.props(styles.acts)}>
        {isSelf ? (
          <>
            <EditProfileButton profile={profile} />
            <form action={signOut}>
              <Button type="submit" variant="tertiary" size="sm">
                <LogOutIcon />
                Log out
              </Button>
            </form>
          </>
        ) : (
          <FollowButton profileId={profile.id} isFollowing={isFollowing} />
        )}
      </div>
    </section>
  );
}

const styles = stylex.create({
  card: {
    display: "grid",
    gridTemplateColumns: "84px 1fr",
    gap: 16,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 20,
    paddingInline: 20,
  },
  name: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.625rem",
    lineHeight: 1.15,
    color: colors.burnt,
    overflowWrap: "anywhere",
  },
  handle: {
    margin: 0,
    marginTop: 2,
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
    overflowWrap: "anywhere",
  },
  bio: {
    margin: 0,
    marginTop: 8,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    lineHeight: 1.5,
    color: colors.ink,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  counts: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6,
    margin: 0,
    marginTop: 10,
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
    fontVariantNumeric: "tabular-nums",
  },
  count: { whiteSpace: "nowrap" },
  dot: { marginInlineEnd: 6, color: colors.muted },
  number: { fontWeight: 800, color: colors.ink },
  acts: {
    gridColumn: "1 / -1",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
  },
});
