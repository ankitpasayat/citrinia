"use client";

// One peel. Avatar and name go to the profile, the timestamp and the pictures go
// to the thread, and the actions row sits underneath. The body is no longer one
// big link -- it has @handles and #hashtags in it now, and an <a> cannot hold
// another <a>. Your own peels get a dots menu whose delete asks once before it
// fires. Popovers live in the top layer with no anchor of their own, so the menu
// is measured off its trigger when it opens.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { startTransition, useId, useRef, useState } from "react";
import { deletePeel } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { Avatar } from "./avatar";
import { BookmarkButton } from "./bookmark-button";
import { Button } from "./button";
import { MoreIcon, RepeatIcon, ReplyIcon, TrashIcon } from "./icons";
import { chipStyles, LikeChip } from "./like-chip";
import { MediaGrid } from "./media-grid";
import { QuoteCard } from "./quote-card";
import { RepostButton } from "./repost-button";
import { RichText } from "./rich-text";

const MENU_WIDTH = 220;
const GAP = 8;

export function PeelCard({
  peel,
  viewerId,
  embed = false,
  onOptimisticLike,
  onOptimisticRemove,
  onOptimisticRepost,
  onOptimisticBookmark,
  onQuote,
}: {
  peel: PeelUnionAuthor;
  viewerId: string;
  /** On the peel page: YouTube plays inline and the pictures stop linking here. */
  embed?: boolean;
  onOptimisticLike: (next: PeelUnionAuthor) => void;
  onOptimisticRemove: (id: string) => void;
  onOptimisticRepost: (next: PeelUnionAuthor) => void;
  onOptimisticBookmark: (next: PeelUnionAuthor) => void;
  onQuote: (peel: PeelUnionAuthor) => void;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: GAP, right: GAP });
  const [confirming, setConfirming] = useState(false);

  const author = peel.author;
  const profileHref = `/u/${author.username}`;
  const threadHref = `/p/${peel.id}`;
  const reposter = peel.reposted_by;

  function onMenuToggle(event: React.ToggleEvent<HTMLDivElement>) {
    if (event.newState !== "open") {
      setConfirming(false); // A reopened menu always asks again.
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamp all four edges so neither a narrow viewport nor a card sitting at the
    // bottom of the screen pushes the menu off it. `toggle` fires once the popover
    // is in the top layer, so its height is measurable here.
    const maxRight = Math.max(GAP, window.innerWidth - MENU_WIDTH - GAP);
    const height = menu.current?.offsetHeight ?? 0;
    const maxTop = Math.max(GAP, window.innerHeight - height - GAP);
    setPos({
      top: Math.min(Math.max(GAP, rect.bottom + GAP), maxTop),
      right: Math.min(Math.max(GAP, window.innerWidth - rect.right), maxRight),
    });
  }

  function onDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    menu.current?.hidePopover();
    startTransition(async () => {
      onOptimisticRemove(peel.id);
      // A failure leaves the server state alone, so the card comes back on its own.
      await deletePeel(peel.id);
    });
  }

  return (
    <article {...stylex.props(styles.card)}>
      {/* Why this peel is on your timeline at all: somebody put it back. */}
      {reposter && (
        <p {...stylex.props(styles.repeeled)}>
          <RepeatIcon style={styles.repeeledIcon} />
          Repeeled by{" "}
          <Link href={`/u/${reposter.username}`} {...stylex.props(styles.repeeledName)}>
            {reposter.name}
          </Link>
        </p>
      )}

      {/* The name below is the accessible link to the same place; this one is decoration. */}
      <Link href={profileHref} tabIndex={-1} aria-hidden="true" {...stylex.props(styles.avatarLink)}>
        <Avatar src={author.avatar_url} name={author.name} />
      </Link>

      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.who)}>
          <Link href={profileHref} {...stylex.props(styles.name)}>
            {author.name}
          </Link>
          <span {...stylex.props(styles.meta)}>@{author.username}</span>
          {/* Relative times are computed from the reader's clock, which is not the server's. */}
          <Link href={threadHref} aria-label="Open this peel" {...stylex.props(styles.timeLink)}>
            <time
              dateTime={peel.created_at}
              title={fullTime(peel.created_at)}
              suppressHydrationWarning
              {...stylex.props(styles.meta, styles.time)}
            >
              {formatRelative(peel.created_at)}
            </time>
          </Link>
        </div>

        <RichText text={peel.title} />
        <MediaGrid media={peel.media} href={threadHref} authorName={author.name} embed={embed} />
        {peel.quote && <QuoteCard quote={peel.quote} />}

        <div {...stylex.props(styles.acts)}>
          <LikeChip peel={peel} onOptimisticLike={onOptimisticLike} />
          <Link
            href={threadHref}
            aria-label={`${peel.replies} ${peel.replies === 1 ? "reply" : "replies"}`}
            {...stylex.props(chipStyles.base, styles.replyChip)}
          >
            <ReplyIcon style={styles.replyIcon} />
            <span {...stylex.props(styles.count)}>{peel.replies}</span>
          </Link>
          <RepostButton
            peel={peel}
            viewerId={viewerId}
            onOptimisticRepost={onOptimisticRepost}
            onQuote={onQuote}
          />

          <span {...stylex.props(styles.push)}>
            <BookmarkButton peel={peel} onOptimisticBookmark={onOptimisticBookmark} />
          </span>

          {peel.user_id === viewerId && (
            <>
              <Button ref={trigger} variant="icon" aria-label="More" popoverTarget={menuId}>
                <MoreIcon />
              </Button>
              <div
                ref={menu}
                id={menuId}
                popover="auto"
                onToggle={onMenuToggle}
                {...stylex.props(styles.menu)}
                style={pos}
              >
                <button type="button" onClick={onDelete} {...stylex.props(styles.menuItem)}>
                  <TrashIcon />
                  {confirming ? "Really delete? Tap again" : "Delete peel"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

const styles = stylex.create({
  card: {
    display: "grid",
    gridTemplateColumns: "40px 1fr",
    gap: 12,
    alignItems: "start",
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 16,
    paddingInline: 16,
  },
  repeeled: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    marginBottom: -4,
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
  },
  repeeledIcon: { width: 15, height: 15 },
  repeeledName: {
    color: colors.muted,
    fontWeight: 800,
    textDecorationLine: { default: "none", [bp.hover]: { default: "none", ":hover": "underline" } },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
    borderRadius: 4,
  },
  avatarLink: { display: "block", borderRadius: "50%", textDecorationLine: "none" },
  content: { minWidth: 0 },
  who: { display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  name: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: 1.2,
    color: colors.burnt,
    textDecorationLine: { default: "none", [bp.hover]: { default: "none", ":hover": "underline" } },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
    borderRadius: 4,
  },
  meta: {
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
  },
  timeLink: {
    marginLeft: "auto",
    textDecorationLine: { default: "none", [bp.hover]: { default: "none", ":hover": "underline" } },
    color: "inherit",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
    borderRadius: 4,
  },
  time: { fontVariantNumeric: "tabular-nums" },
  acts: { display: "flex", alignItems: "center", gap: 6 },
  replyChip: { textDecorationLine: "none" },
  replyIcon: { width: 18, height: 18 },
  count: { fontVariantNumeric: "tabular-nums" },
  push: { marginLeft: "auto", display: "inline-flex" },
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
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    minHeight: 44,
    textAlign: "left",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.875rem",
    color: colors.danger,
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
