// Who a conversation is with, above it: the way back to the list, and their
// name, which leads to their profile. Server-safe.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Avatar } from "./avatar";
import { ArrowLeftIcon } from "./icons";

export function ConversationHead({ other }: { other: Profile }) {
  return (
    <header {...stylex.props(styles.head)}>
      {/* The rail and the split view both keep the list in sight, so the way
          back is only needed where the conversation is the whole screen. */}
      <Link href="/messages" aria-label="Back to messages" {...stylex.props(styles.back)}>
        <ArrowLeftIcon />
      </Link>
      <Link href={`/u/${encodeURIComponent(other.username)}`} {...stylex.props(styles.who)}>
        <Avatar src={other.avatar_url} name={other.name} size="sm" />
        <span {...stylex.props(styles.text)}>
          <b {...stylex.props(styles.name)}>{other.name}</b>
          <span {...stylex.props(styles.handle)}>@{other.username}</span>
        </span>
      </Link>
    </header>
  );
}

const styles = stylex.create({
  head: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    position: "sticky",
    top: 0,
    zIndex: 2,
    paddingBlock: 8,
    backgroundColor: colors.ground,
  },
  back: {
    display: { default: "grid", [bp.split]: "none" },
    placeItems: "center",
    width: 40,
    height: 40,
    flexShrink: 0,
    color: colors.burnt,
    borderRadius: shape.pill,
    backgroundColor: { default: "transparent", ":hover": colors.chip },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  who: {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    paddingBlock: 4,
    paddingInline: 6,
    textDecorationLine: "none",
    borderRadius: 14,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 2,
  },
  text: { display: "grid", minWidth: 0 },
  name: {
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.0625rem",
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
});
