"use client";

// The avatar in the band opens a menu: your peels, your bookmarks, settings, and
// the way out. Theme used to sit here as a third control inside a menu row; it
// lives on /settings now, where the rest of the switches are.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { colors, fonts } from "@/app/tokens.stylex";
import { Avatar } from "./avatar";
import { BookmarkIcon, GearIcon, LogOutIcon, UserIcon } from "./icons";
import { menuStyles, useMenu } from "./menu";

export function AccountMenu({ profile }: { profile: Profile }) {
  const { menuId, trigger, menu, pos, onToggle, close } = useMenu();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Account menu"
        popoverTarget={menuId}
        {...stylex.props(styles.trigger)}
      >
        <Avatar src={profile.avatar_url} name={profile.name} ring />
      </button>

      <div ref={menu} id={menuId} popover="auto" onToggle={onToggle} {...stylex.props(menuStyles.menu)} style={pos}>
        <div {...stylex.props(styles.who)}>
          <b {...stylex.props(styles.whoName)}>{profile.name}</b>
          <span {...stylex.props(styles.whoHandle)}>@{profile.username}</span>
        </div>

        <Link href={`/u/${profile.username}`} onClick={close} {...stylex.props(menuStyles.item)}>
          <UserIcon />
          Your peels
        </Link>

        <Link href="/bookmarks" onClick={close} {...stylex.props(menuStyles.item)}>
          <BookmarkIcon />
          Bookmarks
        </Link>

        <Link href="/settings" onClick={close} {...stylex.props(menuStyles.item)}>
          <GearIcon />
          Settings
        </Link>

        <hr {...stylex.props(menuStyles.rule)} />

        <form action={signOut}>
          <button type="submit" {...stylex.props(menuStyles.item, menuStyles.danger)}>
            <LogOutIcon />
            Log out
          </button>
        </form>
      </div>
    </>
  );
}

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    padding: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: "50%",
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  who: {
    paddingTop: 8,
    paddingInline: 10,
    paddingBottom: 10,
    marginBottom: 6,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: colors.chip,
  },
  whoName: {
    display: "block",
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.125rem",
    lineHeight: 1.2,
    color: colors.burnt,
  },
  whoHandle: { fontSize: "0.8125rem", fontWeight: 700, color: colors.muted },
});
