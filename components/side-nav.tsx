"use client";

// The rail: the mark, the five destinations and the compose button. The bottom
// bar's twin from the tablet breakpoint up; hidden below it. Icons stacked over
// small labels until the wide breakpoint, where it grows to the labelled column.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Button } from "./button";
import { BellIcon, HomeIcon, MailIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { isOn } from "./tabs";
import { MessageBadge } from "./message-badge";
import { UnreadBadge } from "./unread-badge";

export function SideNav({ username, onCompose }: { username: string; onCompose: () => void }) {
  const pathname = usePathname();
  const you = `/u/${username}`;

  return (
    <nav {...stylex.props(styles.rail)} aria-label="Main">
      <Link href="/" {...stylex.props(styles.brand)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the app icon, one static svg */}
        <img src="/icon.svg" alt="" width={44} height={44} />
        <span {...stylex.props(styles.wordmark)}>Citrinia</span>
      </Link>

      <Item href="/" label="Feed" on={isOn(pathname, "/")}>
        <HomeIcon style={styles.icon} />
      </Item>
      <Item href="/explore" label="Explore" on={isOn(pathname, "/explore")}>
        <SearchIcon style={styles.icon} />
      </Item>
      <Item href="/notifications" label="Alerts" on={isOn(pathname, "/notifications")}>
        <BellIcon style={styles.icon} />
        <UnreadBadge />
      </Item>
      <Item href="/messages" label="Messages" on={isOn(pathname, "/messages")}>
        <MailIcon style={styles.icon} />
        <MessageBadge />
      </Item>
      {/* The rail has the room the phone bar does not, so You keeps its place here. */}
      <Item href={you} label="You" on={isOn(pathname, you)}>
        <UserIcon style={styles.icon} />
      </Item>

      {/* One compose control per width: the round button on the icon rail, the
          labelled one on the wide rail. Only one is ever displayed. */}
      <Button variant="fab" aria-label="New peel" onClick={onCompose} style={styles.composeFab}>
        <PlusIcon style={styles.plusFab} />
      </Button>
      <Button variant="primary" size="lg" onClick={onCompose} style={styles.compose}>
        <PlusIcon style={styles.plus} />
        New peel
      </Button>
    </nav>
  );
}

function Item({ href, label, on, children }: { href: string; label: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} {...stylex.props(styles.item, on && styles.active)}>
      <span {...stylex.props(styles.mark)}>{children}</span>
      {label}
    </Link>
  );
}

const styles = stylex.create({
  rail: {
    display: { default: "none", [bp.tablet]: "flex" },
    flexDirection: "column",
    alignItems: { default: "center", [bp.wide]: "stretch" },
    gap: 4,
    position: "sticky",
    top: 0,
    paddingTop: "calc(16px + env(safe-area-inset-top))",
    paddingBottom: 24,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingInline: { default: 0, [bp.wide]: 12 },
    paddingBlock: 8,
    marginBottom: 12,
    textDecorationLine: "none",
    borderRadius: shape.pill,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  wordmark: {
    display: { default: "none", [bp.wide]: "inline" },
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.75rem",
    lineHeight: 1,
    letterSpacing: "0.01em",
    color: colors.burnt,
  },
  item: {
    display: { default: "grid", [bp.wide]: "flex" },
    justifyItems: "center",
    alignItems: "center",
    gap: { default: 4, [bp.wide]: 14 },
    width: { default: 64, [bp.wide]: "auto" },
    minHeight: { default: 56, [bp.wide]: 48 },
    paddingInline: { default: 0, [bp.wide]: 14 },
    paddingBlock: { default: 6, [bp.wide]: 0 },
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: { default: "0.625rem", [bp.wide]: "1.0625rem" },
    lineHeight: 1,
    color: colors.muted,
    textAlign: "center",
    textDecorationLine: "none",
    borderRadius: { default: 16, [bp.wide]: shape.pill },
    backgroundColor: { default: "transparent", ":hover": colors.chip },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  active: { color: colors.burnt, backgroundColor: colors.surface },
  mark: { position: "relative", display: "grid", placeItems: "center" },
  icon: { width: 24, height: 24 },
  compose: { display: { default: "none", [bp.wide]: "inline-flex" }, marginTop: 16, justifyContent: "center" },
  plus: { width: 20, height: 20 },
  composeFab: { display: { default: "inline-flex", [bp.wide]: "none" }, marginTop: 12 },
  plusFab: { width: 28, height: 28 },
});
