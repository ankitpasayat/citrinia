"use client";

// Repeel. The chip is a menu, not a toggle: putting somebody's peel back on your
// timeline and quoting it are two different things, and tapping the wrong one by
// reflex is the kind of mistake that needs undoing in public. Popovers live in
// the top layer with no anchor of their own, so the menu is measured off the chip
// when it opens (the same trick as account-menu.tsx).
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition, useId, useRef, useState } from "react";
import { repost, unrepost } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { RepeatIcon } from "./icons";
import { chipStyles } from "./like-chip";

const MENU_WIDTH = 200;
const GAP = 8;

export function RepostButton({
  peel,
  viewerId,
  onOptimisticRepost,
  onQuote,
}: {
  peel: PeelUnionAuthor;
  viewerId: string;
  onOptimisticRepost: (next: PeelUnionAuthor) => void;
  onQuote: (peel: PeelUnionAuthor) => void;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: GAP, right: GAP });

  const reposted = peel.user_has_reposted;
  // Repeeling your own peel would only ever say your own thing twice; quoting it
  // adds something. The database allows both; the menu offers the useful one.
  const mine = peel.user_id === viewerId;

  function place(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState !== "open") return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamp all four edges: a narrow viewport or a chip near the bottom of the
    // screen would otherwise push the menu off it.
    const maxRight = Math.max(GAP, window.innerWidth - MENU_WIDTH - GAP);
    const height = menu.current?.offsetHeight ?? 0;
    const maxTop = Math.max(GAP, window.innerHeight - height - GAP);
    setPos({
      top: Math.min(Math.max(GAP, rect.bottom + GAP), maxTop),
      right: Math.min(Math.max(GAP, window.innerWidth - rect.right), maxRight),
    });
  }

  const router = useRouter();

  function toggle() {
    menu.current?.hidePopover();
    // React 19: the optimistic update has to happen inside a transition, before any await.
    startTransition(async () => {
      onOptimisticRepost({
        ...peel,
        reposts: peel.reposts + (reposted ? -1 : 1),
        user_has_reposted: !reposted,
      });
      // A failure leaves the server state alone, so the refresh puts the count back.
      await (reposted ? unrepost(peel.id) : repost(peel.id));
      router.refresh();
    });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={menuId}
        aria-pressed={reposted}
        aria-label={`Repeel, ${peel.reposts} ${peel.reposts === 1 ? "repeel" : "repeels"}`}
        {...stylex.props(chipStyles.base, reposted && styles.pressed)}
      >
        <RepeatIcon style={styles.icon} />
        <span {...stylex.props(styles.count)}>{peel.reposts}</span>
      </button>

      <div ref={menu} id={menuId} popover="auto" onToggle={place} {...stylex.props(styles.menu)} style={pos}>
        {!mine && (
          <button type="button" onClick={toggle} {...stylex.props(styles.item)}>
            <RepeatIcon />
            {reposted ? "Undo repeel" : "Repeel"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            menu.current?.hidePopover();
            onQuote(peel);
          }}
          {...stylex.props(styles.item)}
        >
          <RepeatIcon />
          Quote
        </button>
      </div>
    </>
  );
}

const styles = stylex.create({
  pressed: {
    backgroundColor: {
      default: colors.mustard,
      [bp.hover]: { default: colors.mustard, ":hover": colors.mustard },
    },
    color: colors.burnt,
  },
  icon: { width: 18, height: 18 },
  count: { fontVariantNumeric: "tabular-nums" },
  menu: {
    position: "fixed",
    top: "auto",
    right: "auto",
    bottom: "auto",
    left: "auto",
    marginBlock: 0,
    marginInline: 0,
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
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
});
