"use client";

// The popover menus: the dots on a peel, the avatar in the band, the dots on
// somebody's profile. All three were the same forty lines, so they are these
// forty instead.
//
// A popover lives in the top layer with `position: fixed; inset: auto`, and
// nothing anchors it for us -- so measure the trigger when the popover opens and
// pin the menu's top-right corner under it.
import * as stylex from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

const MENU_WIDTH = 220;
const GAP = 8;

/**
 * Everything a popover menu needs: the id that ties trigger to menu, refs for
 * both, the position to spread onto the menu's `style`, and a way to close it
 * from a row's onClick.
 *
 * `onClosed` runs when the menu goes away by any route -- Escape, a click
 * outside, or a row closing it -- which is where a menu with a confirm step puts
 * itself back to asking.
 */
export function useMenu(onClosed?: () => void) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: GAP, right: GAP });

  function onToggle(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState !== "open") {
      onClosed?.();
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamp all four edges, so neither a narrow viewport nor a trigger sitting
    // at the bottom of the screen pushes the menu off it. `toggle` fires once
    // the popover is in the top layer, so its height is measurable here.
    const maxRight = Math.max(GAP, window.innerWidth - MENU_WIDTH - GAP);
    const height = menu.current?.offsetHeight ?? 0;
    const maxTop = Math.max(GAP, window.innerHeight - height - GAP);
    setPos({
      top: Math.min(Math.max(GAP, rect.bottom + GAP), maxTop),
      right: Math.min(Math.max(GAP, window.innerWidth - rect.right), maxRight),
    });
  }

  return { menuId, trigger, menu, pos, onToggle, close: () => menu.current?.hidePopover() };
}

const styles = stylex.create({
  menu: {
    position: "fixed",
    top: "auto",
    right: "auto",
    bottom: "auto",
    left: "auto",
    marginBlock: 0,
    marginInline: 0,
    // No `display` here, ever: the UA hides a closed popover with `display: none`,
    // and an author rule of any kind beats it -- which paints every card's menu
    // open over the page. The rows stack on their own.
    minWidth: MENU_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    paddingBlock: 8,
    paddingInline: 8,
    backgroundColor: colors.surface,
    color: colors.ink,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.band,
    boxShadow: colors.shadowLg,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    minHeight: 44,
    textAlign: "left",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.875rem",
    lineHeight: 1,
    color: colors.ink,
    backgroundColor: {
      default: "transparent",
      [bp.hover]: { default: "transparent", ":hover": colors.chip },
    },
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 12,
    paddingBlock: 10,
    paddingInline: 10,
    // Rows are <button> and <a> alike; the anchors must not carry an underline.
    textDecorationLine: "none",
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  rule: {
    borderWidth: 0,
    borderTopWidth: 2,
    borderTopStyle: "solid",
    borderTopColor: colors.chip,
    marginBlock: 4,
    marginInline: 0,
    width: "100%",
  },
  danger: { color: colors.danger },
});

/** Spread onto the popover and its rows: menuStyles.menu, .item, .rule, .danger. */
export const menuStyles = {
  get menu() {
    return styles.menu;
  },
  get item() {
    return styles.item;
  },
  get rule() {
    return styles.rule;
  },
  get danger() {
    return styles.danger;
  },
};
