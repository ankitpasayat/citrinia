"use client";

// The notifications screen's body. It marks the batch read once after mount --
// opening the screen is the act of reading them -- and tells the tab bar to drop
// its badge without waiting for the next navigation.
//
// The rows keep the tint they had when the screen opened: marking read
// revalidates this route, and a list that un-highlights itself while you are
// looking at it hides the very thing you came to see.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { useEffect, useState } from "react";
import { markNotificationsRead } from "@/app/actions";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { Avatar } from "./avatar";
import { NOTIFICATIONS_READ_EVENT } from "./unread-badge";

const EXCERPT = 120;

const SAID: Record<NotificationItem["type"], string> = {
  like: "liked your peel",
  reply: "replied to your peel",
  quote: "quoted your peel",
  mention: "mentioned you",
  follow: "followed you",
  repost: "repeeled your peel",
};

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const unread = items.some((item) => item.read_at === null);
  // Snapshotted at mount, so the revalidation that follows the mark-read does not
  // wipe the highlights out from under the reader.
  const [wasUnread] = useState(
    () => new Set(items.filter((item) => item.read_at === null).map((item) => item.id)),
  );

  useEffect(() => {
    if (!unread) return;
    let live = true;
    markNotificationsRead().then(() => {
      if (live) window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
    });
    return () => {
      live = false;
    };
  }, [unread]);

  return (
    <div {...stylex.props(styles.list)}>
      {items.map((item) => {
        // A follow points at the person; everything else points at the peel it is
        // about, and falls back to the person when that peel has been composted.
        const href = item.peel ? `/p/${item.peel.id}` : `/u/${item.actor.username}`;
        const detail = item.peel ? item.peel.title.slice(0, EXCERPT) : `@${item.actor.username}`;

        return (
          <Link
            key={item.id}
            href={href}
            {...stylex.props(styles.row, wasUnread.has(item.id) && styles.fresh)}
          >
            <Avatar src={item.actor.avatar_url} name={item.actor.name} size="sm" />

            <span {...stylex.props(styles.text)}>
              <span {...stylex.props(styles.said)}>
                <b {...stylex.props(styles.who)}>{item.actor.name}</b> {SAID[item.type]}
              </span>
              <span {...stylex.props(styles.detail)}>{detail}</span>
            </span>

            <time
              dateTime={item.created_at}
              title={fullTime(item.created_at)}
              suppressHydrationWarning
              {...stylex.props(styles.time)}
            >
              {formatRelative(item.created_at)}
            </time>
          </Link>
        );
      })}
    </div>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 8,
    paddingInline: 8,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "start",
    minHeight: 44,
    paddingBlock: 9,
    paddingInline: 9,
    borderRadius: 16,
    textDecorationLine: "none",
    // Always three pixels wide, so the unread rule tints in without shifting the row.
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    backgroundColor: {
      default: "transparent",
      [bp.hover]: { default: "transparent", ":hover": colors.chip },
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -1,
  },
  fresh: { backgroundColor: colors.chip, borderLeftColor: colors.burnt },
  text: { display: "grid", gap: 2, minWidth: 0 },
  said: {
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    lineHeight: 1.35,
    color: colors.ink,
    overflowWrap: "anywhere",
  },
  who: { fontFamily: fonts.display, fontWeight: 400, color: colors.burnt },
  detail: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    lineHeight: 1.35,
    color: colors.muted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  time: {
    fontSize: "0.8125rem",
    fontWeight: 700,
    lineHeight: 1.35,
    color: colors.muted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    paddingTop: 1,
  },
});
