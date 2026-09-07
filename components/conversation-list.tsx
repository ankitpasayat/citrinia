// The inbox: one row per conversation, newest first. Who it is with, the last
// thing said in it, when, and a dot when that last thing is theirs and you have
// not opened it since. Server-safe; the requests tab passes its buttons in.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import type { ReactNode } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import type { Thread } from "@/lib/conversations";
import { isUnread } from "@/lib/messages";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { Avatar } from "./avatar";

export function ConversationList({
  threads,
  viewerId,
  action,
}: {
  threads: Thread[];
  viewerId: string;
  /** What sits at the end of a row: Accept and Delete, on the requests tab. */
  action?: (thread: Thread) => ReactNode;
}) {
  return (
    <ul {...stylex.props(styles.list)}>
      {threads.map(({ conversation, other }) => {
        const unread = isUnread(conversation, viewerId);
        return (
          <li key={conversation.id} {...stylex.props(styles.item)}>
            <Link href={`/messages/${conversation.id}`} {...stylex.props(styles.row)}>
              <Avatar src={other.avatar_url} name={other.name} />
              <span {...stylex.props(styles.text)}>
                <span {...stylex.props(styles.head)}>
                  <b {...stylex.props(styles.name)}>{other.name}</b>
                  <span {...stylex.props(styles.handle)}>@{other.username}</span>
                  <time
                    dateTime={conversation.last_message_at}
                    title={fullTime(conversation.last_message_at)}
                    {...stylex.props(styles.when)}
                  >
                    {formatRelative(conversation.last_message_at)}
                  </time>
                </span>
                <span {...stylex.props(styles.preview, unread && styles.unreadPreview)}>
                  {/* The sender's own line reads as an answer, not as news. */}
                  {conversation.last_sender_id === viewerId && (
                    <span {...stylex.props(styles.you)}>You: </span>
                  )}
                  {conversation.last_preview}
                </span>
              </span>
              {unread && <span role="img" aria-label="Unread" {...stylex.props(styles.dot)} />}
            </Link>
            {action?.({ conversation, other })}
          </li>
        );
      })}
    </ul>
  );
}

const styles = stylex.create({
  list: { display: "grid", gap: 8, margin: 0, padding: 0, listStyleType: "none" },
  item: {
    display: "grid",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 12,
    paddingInline: 14,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
    textDecorationLine: "none",
    borderRadius: 16,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 4,
  },
  text: { display: "grid", gap: 3, minWidth: 0 },
  head: { display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 },
  name: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: 1.2,
    color: colors.burnt,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  handle: {
    fontFamily: fonts.body,
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  when: { marginInlineStart: "auto", flexShrink: 0, fontFamily: fonts.body, fontSize: "0.75rem", fontWeight: 700, color: colors.muted },
  preview: {
    fontFamily: fonts.body,
    fontSize: "0.875rem",
    fontWeight: 600,
    lineHeight: 1.35,
    color: colors.muted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  unreadPreview: { color: colors.ink, fontWeight: 800 },
  you: { color: colors.muted, fontWeight: 700 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: shape.pill,
    backgroundColor: colors.burnt,
    flexShrink: 0,
  },
});
