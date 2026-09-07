// The head of a profile page: big avatar, name, handle, bio, counts, and the one
// action that belongs to the viewer — follow someone else, or edit and log out
// of your own. Server component; the two interactive bits are client children.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Avatar } from "./avatar";
import { Button, buttonStyles } from "./button";
import { EditProfileButton } from "./edit-profile-sheet";
import { FollowButton } from "./follow-button";
import { BookmarkIcon, LogOutIcon } from "./icons";

export type ProfileCounts = { peels: number; followers: number; following: number };

type Props = {
  profile: Profile;
  counts: ProfileCounts;
  isSelf: boolean;
  isFollowing: boolean;
};

export function ProfileCard({ profile, counts, isSelf, isFollowing }: Props) {
  const base = `/u/${encodeURIComponent(profile.username)}`;
  // "1 peel", not "1 peels". "following" has no singular to get wrong.
  // The two follow counts are the way to those lists; the peel count is a fact.
  const items: { n: number; label: string; href?: string }[] = [
    { n: counts.peels, label: counts.peels === 1 ? "peel" : "peels" },
    {
      n: counts.followers,
      label: counts.followers === 1 ? "follower" : "followers",
      href: `${base}/followers`,
    },
    { n: counts.following, label: "following", href: `${base}/following` },
  ];

  return (
    <section {...stylex.props(styles.card)}>
      <Avatar src={profile.avatar_url} name={profile.name} size="lg" />

      <div>
        <h1 {...stylex.props(styles.name)}>{profile.name}</h1>
        <p {...stylex.props(styles.handle)}>@{profile.username}</p>
        {profile.bio !== "" && <p {...stylex.props(styles.bio)}>{profile.bio}</p>}

        <p {...stylex.props(styles.counts)}>
          {items.map((item, i) => {
            const said = (
              <>
                <b {...stylex.props(styles.number)}>{item.n.toLocaleString("en-US")}</b> {item.label}
              </>
            );
            return (
              <span key={item.label} {...stylex.props(styles.count)}>
                {i > 0 && <span {...stylex.props(styles.dot)} aria-hidden="true">·</span>}
                {/* The whole count reads as the link, so it is named "12 followers". */}
                {item.href ? (
                  <Link href={item.href} {...stylex.props(styles.countLink)}>
                    {said}
                  </Link>
                ) : (
                  said
                )}
              </span>
            );
          })}
        </p>
      </div>

      <div {...stylex.props(styles.acts)}>
        {isSelf ? (
          <>
            <EditProfileButton profile={profile} />
            {/* The only way to your bookmarks that is not buried in a menu. */}
            <Link
              href="/bookmarks"
              {...stylex.props(
                buttonStyles.base,
                buttonStyles.variants.secondary,
                buttonStyles.sizes.sm,
              )}
            >
              <BookmarkIcon />
              Bookmarks
            </Link>
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
  countLink: {
    color: "inherit",
    textDecorationLine: {
      default: "none",
      [bp.hover]: { default: "none", ":hover": "underline" },
    },
    textUnderlineOffset: 3,
    borderRadius: 6,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
  },
  acts: {
    gridColumn: "1 / -1",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
  },
});
