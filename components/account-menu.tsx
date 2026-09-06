"use client";

// The avatar in the band opens a native popover. Popovers live in the top layer
// with `position: fixed; inset: auto`, so nothing anchors them for us: measure the
// trigger when the popover opens and pin the menu's right edge to the avatar's.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Avatar } from "./avatar";
import { BookmarkIcon, LogOutIcon, UserIcon } from "./icons";
import { ThemeSetting } from "./theme-setting";

const MENU_WIDTH = 220;
const GAP = 8;

export function AccountMenu({ profile }: { profile: Profile }) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: GAP, right: GAP });

  function place(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState !== "open") return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamp both edges so a narrow viewport (390px) never pushes the menu off screen.
    const maxRight = Math.max(GAP, window.innerWidth - MENU_WIDTH - GAP);
    setPos({
      top: Math.max(GAP, rect.bottom + GAP),
      right: Math.min(Math.max(GAP, window.innerWidth - rect.right), maxRight),
    });
  }

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

      <div ref={menu} id={menuId} popover="auto" onToggle={place} {...stylex.props(styles.menu)} style={pos}>
        <div {...stylex.props(styles.who)}>
          <b {...stylex.props(styles.whoName)}>{profile.name}</b>
          <span {...stylex.props(styles.whoHandle)}>@{profile.username}</span>
        </div>

        <Link
          href={`/u/${profile.username}`}
          onClick={() => menu.current?.hidePopover()}
          {...stylex.props(styles.row)}
        >
          <UserIcon />
          Your peels
        </Link>

        <Link
          href="/bookmarks"
          onClick={() => menu.current?.hidePopover()}
          {...stylex.props(styles.row)}
        >
          <BookmarkIcon />
          Bookmarks
        </Link>

        <div {...stylex.props(styles.row, styles.themeRow)}>
          Theme
          <ThemeSetting />
        </div>

        <form action={signOut}>
          <button type="submit" {...stylex.props(styles.row, styles.danger)}>
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
  menu: {
    position: "fixed",
    inset: "auto",
    margin: 0,
    minWidth: MENU_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    paddingBlock: 8,
    paddingInline: 8,
    backgroundColor: colors.surface,
    color: colors.ink,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.card,
    boxShadow: colors.shadowLg,
    overflow: "visible",
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
  whoName: { display: "block", fontFamily: fonts.display, fontWeight: 400, fontSize: "1.125rem", lineHeight: 1.2, color: colors.burnt },
  whoHandle: { fontSize: "0.8125rem", fontWeight: 700, color: colors.muted },
  row: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    textAlign: "left",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.875rem",
    lineHeight: 1,
    color: colors.ink,
    backgroundColor: { default: "transparent", [bp.hover]: { default: "transparent", ":hover": colors.chip } },
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 12,
    paddingBlock: 10,
    paddingInline: 10,
    textDecorationLine: "none",
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  themeRow: { justifyContent: "space-between", cursor: "default", backgroundColor: "transparent" },
  danger: { color: colors.danger },
});
