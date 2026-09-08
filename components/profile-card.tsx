// The head of a profile page: banner, big avatar, name, handle, bio, the facts
// underneath, counts, and the actions that belong to the viewer — follow and a
// dots menu on someone else's, edit and log out on your own. Signed out only
// Follow is there, as a link to the door: a message needs somebody to send it,
// and muting or blocking needs somebody to do the not-seeing. Server component;
// the interactive bits are client children.
/* eslint-disable @next/next/no-img-element -- a Storage url, sized by CSS; no optimizer config to add */
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { displayWebsite } from "@/lib/profile";
import { formatMonthYear } from "@/lib/relative-time";
import { Avatar } from "./avatar";
import { BlockButton } from "./block-button";
import { Button, buttonStyles } from "./button";
import { EditProfileButton } from "./edit-profile-sheet";
import { FollowButton } from "./follow-button";
import { BookmarkIcon, CalendarIcon, GearIcon, LinkIcon, LogOutIcon, MailIcon, MapPinIcon } from "./icons";
import { ProfileMenu } from "./profile-menu";

export type ProfileCounts = { peels: number; followers: number; following: number };

type Props = {
  profile: Profile;
  counts: ProfileCounts;
  isSelf: boolean;
  isFollowing: boolean;
  /** No session: Follow is a link to /login, and nothing else here applies. */
  signedIn: boolean;
  /** Whether the viewer has muted this profile, for the dots menu's label. */
  isMuted: boolean;
  /** The viewer blocked them: Unblock stands where Follow would. */
  isBlocked: boolean;
  /** They blocked the viewer: there is nothing here to press. */
  blockedByThem: boolean;
};

export function ProfileCard({
  profile,
  counts,
  isSelf,
  isFollowing,
  signedIn,
  isMuted,
  isBlocked,
  blockedByThem,
}: Props) {
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
  const joined = formatMonthYear(profile.created_at);

  return (
    <section {...stylex.props(styles.card)}>
      {profile.banner_url !== "" && (
        <div {...stylex.props(styles.banner)}>
          {/* Decorative: the profile says who this is in text right underneath. */}
          <img src={profile.banner_url} alt="" {...stylex.props(styles.bannerImg)} />
        </div>
      )}

      <div {...stylex.props(styles.body)}>
        <Avatar src={profile.avatar_url} name={profile.name} size="lg" />

        <div>
          <h1 {...stylex.props(styles.name)}>{profile.name}</h1>
          <p {...stylex.props(styles.handle)}>@{profile.username}</p>
          {profile.bio !== "" && <p {...stylex.props(styles.bio)}>{profile.bio}</p>}

          {(profile.location !== "" || profile.website !== "" || joined !== "") && (
            <p {...stylex.props(styles.meta)}>
              {profile.location !== "" && (
                <span {...stylex.props(styles.metaItem)}>
                  <MapPinIcon />
                  {profile.location}
                </span>
              )}
              {profile.website !== "" && (
                <span {...stylex.props(styles.metaItem)}>
                  <LinkIcon />
                  {/* The column only stores https urls; nofollow because a
                      profile link is somebody else's word, not ours. */}
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    {...stylex.props(styles.link)}
                  >
                    {displayWebsite(profile.website)}
                  </a>
                </span>
              )}
              {joined !== "" && (
                <span {...stylex.props(styles.metaItem)}>
                  <CalendarIcon />
                  Joined {joined}
                </span>
              )}
            </p>
          )}

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
              {/* The rail's You is a link to here, so this is the door to
                  /settings from every page that is not the feed. */}
              <Link
                href="/settings"
                {...stylex.props(
                  buttonStyles.base,
                  buttonStyles.variants.secondary,
                  buttonStyles.sizes.sm,
                )}
              >
                <GearIcon />
                Settings
              </Link>
              <form action={signOut}>
                <Button type="submit" variant="tertiary" size="sm">
                  <LogOutIcon />
                  Log out
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* Follow is not offered across a block in either direction: one
                  way the policy would refuse it, the other way it would be a
                  button that undoes nothing the reader can see. */}
              {isBlocked ? (
                <BlockButton profileId={profile.id} handle={profile.username} isBlocked />
              ) : (
                !blockedByThem && (
                  <>
                    <FollowButton
                      profileId={profile.id}
                      isFollowing={isFollowing}
                      signedIn={signedIn}
                    />
                    {/* The way into a conversation from anywhere a person is.
                        It opens one whether or not they have ever spoken --
                        /messages/with decides that, and nothing is written
                        until a message is sent. Not shown across a block, for
                        the same reason Follow is not: the send would be
                        refused -- nor signed out, where there is nobody for it
                        to be from. */}
                    {signedIn && (
                      <Link
                        href={`/messages/with/${encodeURIComponent(profile.username)}`}
                        {...stylex.props(
                          buttonStyles.base,
                          buttonStyles.variants.secondary,
                          buttonStyles.sizes.sm,
                        )}
                      >
                        <MailIcon />
                        Message
                      </Link>
                    )}
                  </>
                )
              )}
              {signedIn && (
                <ProfileMenu profileId={profile.id} handle={profile.username} isMuted={isMuted} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const styles = stylex.create({
  card: {
    // The padding moved onto .body so the banner can reach the card's edges;
    // overflow clips it to the rounded corners.
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
  },
  banner: {
    display: "block",
    width: "100%",
    aspectRatio: "3 / 1",
    overflow: "hidden",
    backgroundColor: colors.chip,
  },
  bannerImg: { width: "100%", height: "100%", objectFit: "cover" },
  body: {
    display: "grid",
    gridTemplateColumns: "84px 1fr",
    gap: 16,
    alignItems: "center",
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
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    margin: 0,
    marginTop: 10,
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
  },
  metaItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  link: {
    color: colors.burnt,
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
