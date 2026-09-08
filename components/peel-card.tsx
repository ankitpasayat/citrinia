"use client";

// One peel. Avatar and name go to the profile, the timestamp and the pictures go
// to the thread, and the actions row sits underneath. The body is no longer one
// big link -- it has @handles and #hashtags in it now, and an <a> cannot hold
// another <a>. Every peel gets a dots menu -- copy the link, hand it to the
// system share sheet, report somebody else's -- and your own adds a delete that
// asks once before it fires. The menu's plumbing lives in components/menu.tsx.
//
// Signed out the card is the same card with every write taken out of it: the
// four actions keep their counts and their names and go to the door, and the
// menu is down to the two things a browser can do on its own.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { startTransition, useState, useSyncExternalStore } from "react";
import { deletePeel, setPinnedPeel } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { Avatar } from "./avatar";
import { BookmarkButton } from "./bookmark-button";
import { Button } from "./button";
import { FlagIcon, LinkIcon, MoreIcon, PinIcon, RepeatIcon, ReplyIcon, ShareIcon, TrashIcon } from "./icons";
import { KindBadge } from "./kind-badge";
import { chipStyles, LikeChip } from "./like-chip";
import { LinkPreviewCard } from "./link-preview-card";
import { menuStyles, useMenu } from "./menu";
import { MediaGrid } from "./media-grid";
import { QuoteCard } from "./quote-card";
import { ReportSheet } from "./report-sheet";
import { RepostButton } from "./repost-button";
import { RichText } from "./rich-text";
import { toast } from "./toast";

// Whether this browser has a share sheet at all: phones, tablets and the
// Capacitor shell do, most desktops do not, and where it does not exist Copy
// link is the whole story. Read through useSyncExternalStore (a store that never
// changes) rather than an effect, so the server and the first client render
// agree on "no" and hydration stays quiet.
const noSubscribe = () => () => {};
const hasShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
const noShareOnServer = () => false;

export function PeelCard({
  peel,
  viewerId,
  embed = false,
  onOptimisticLike,
  onOptimisticRemove,
  onOptimisticRepost,
  onOptimisticBookmark,
  onQuote,
  pinned = false,
}: {
  peel: PeelUnionAuthor;
  /** null is a signed-out reader: nothing here is theirs, and nothing writes. */
  viewerId: string | null;
  /** On the peel page: YouTube plays inline and the pictures stop linking here. */
  embed?: boolean;
  /**
   * This card is the one leading its author's profile. Only the profile page
   * knows that, which is also the only place the menu can offer to undo it.
   */
  pinned?: boolean;
  onOptimisticLike: (next: PeelUnionAuthor) => void;
  onOptimisticRemove: (id: string) => void;
  onOptimisticRepost: (next: PeelUnionAuthor) => void;
  onOptimisticBookmark: (next: PeelUnionAuthor) => void;
  onQuote: (peel: PeelUnionAuthor) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const canShare = useSyncExternalStore(noSubscribe, hasShare, noShareOnServer);
  // A reopened menu always asks again before it deletes.
  const { menuId, trigger, menu, pos, onToggle, close } = useMenu(() => setConfirming(false));

  const author = peel.author;
  const profileHref = `/u/${author.username}`;
  const threadHref = `/p/${peel.id}`;
  const reposter = peel.reposted_by;
  const signedIn = viewerId !== null;
  const mine = peel.user_id === viewerId;

  /** The link people paste: absolute, because it is leaving the app. */
  function peelUrl(): string {
    return new URL(threadHref, window.location.origin).href;
  }

  async function onCopy() {
    close();
    try {
      await navigator.clipboard.writeText(peelUrl());
      toast("Link copied");
    } catch {
      // Every surface this ships on is a secure context, so a failure here is a
      // refused permission, not a missing API. Silence would look like success.
      toast("Couldn't copy the link", "bad");
    }
  }

  async function onShare() {
    close();
    try {
      await navigator.share({ title: `${author.name} on Citrinia`, url: peelUrl() });
    } catch (error) {
      // Closing the sheet rejects too, and changing your mind is not a failure.
      if ((error as Error).name !== "AbortError") toast("Couldn't open the share sheet", "bad");
    }
  }

  function onReport() {
    close();
    setReporting(true);
  }

  function onPin() {
    close();
    startTransition(async () => {
      await setPinnedPeel(pinned ? null : peel.id);
      toast(pinned ? "Unpinned" : "Pinned to your profile");
    });
  }

  function onDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    close();
    startTransition(async () => {
      onOptimisticRemove(peel.id);
      // A failure leaves the server state alone, so the card comes back on its own.
      await deletePeel(peel.id);
    });
  }

  return (
    <article {...stylex.props(styles.card)}>
      {/* Why this peel is at the top of a profile rather than in date order. */}
      {pinned && (
        <p {...stylex.props(styles.repeeled)}>
          <PinIcon filled />
          Pinned
        </p>
      )}

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
          <span {...stylex.props(styles.meta)}>
            @{author.username} <KindBadge kind={author.kind} />
          </span>
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
        {/* One embedded card per peel: pictures and a quoted peel both own this
            space, and lib/peels.ts leaves `preview` null when either is here. */}
        {peel.preview && <LinkPreviewCard preview={peel.preview} />}
        {peel.quote && <QuoteCard quote={peel.quote} />}

        <div {...stylex.props(styles.acts)}>
          <LikeChip peel={peel} signedIn={signedIn} onOptimisticLike={onOptimisticLike} />
          <Link
            href={threadHref}
            aria-label={`${peel.replies} ${peel.replies === 1 ? "reply" : "replies"}`}
            {...stylex.props(chipStyles.base, chipStyles.link)}
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
            <BookmarkButton
              peel={peel}
              signedIn={signedIn}
              onOptimisticBookmark={onOptimisticBookmark}
            />
          </span>

          <Button ref={trigger} variant="icon" aria-label="More" popoverTarget={menuId}>
            <MoreIcon />
          </Button>
          <div
            ref={menu}
            id={menuId}
            popover="auto"
            onToggle={onToggle}
            {...stylex.props(menuStyles.menu)}
            style={pos}
          >
            <button type="button" onClick={onCopy} {...stylex.props(menuStyles.item)}>
              <LinkIcon />
              Copy link
            </button>

            {canShare && (
              <button type="button" onClick={onShare} {...stylex.props(menuStyles.item)}>
                <ShareIcon />
                Share…
              </button>
            )}

            {/* Copy and Share are the browser's own; reporting somebody is not,
                and there is nobody to report them as until you sign in. */}
            {signedIn && !mine && (
              <>
                <hr {...stylex.props(menuStyles.rule)} />
                <button type="button" onClick={onReport} {...stylex.props(menuStyles.item)}>
                  <FlagIcon />
                  Report peel
                </button>
              </>
            )}

            {mine && (
              <>
                <hr {...stylex.props(menuStyles.rule)} />
                <button type="button" onClick={onPin} {...stylex.props(menuStyles.item)}>
                  <PinIcon filled={pinned} />
                  {pinned ? "Unpin from profile" : "Pin to profile"}
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  {...stylex.props(menuStyles.item, menuStyles.danger)}
                >
                  <TrashIcon />
                  {confirming ? "Really delete? Tap again" : "Delete peel"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mounted on the first ask: a feed is twenty cards, and a dialog nobody
          opened is twenty dialogs nobody opened. */}
      {reporting && (
        <ReportSheet
          subject={{ kind: "peel", id: peel.id, author: author.name }}
          open
          onClose={() => setReporting(false)}
        />
      )}
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
  replyIcon: { width: 18, height: 18 },
  count: { fontVariantNumeric: "tabular-nums" },
  push: { marginLeft: "auto", display: "inline-flex" },
});
