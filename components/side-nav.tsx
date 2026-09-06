"use client";

// The desktop rail: the mark, the four destinations and the compose button. The
// bottom bar's twin from the desktop breakpoint up; hidden below it.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Button } from "./button";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { isOn } from "./tabs";
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
      <Item href="/search" label="Search" on={isOn(pathname, "/search")}>
        <SearchIcon style={styles.icon} />
      </Item>
      <Item href="/notifications" label="Alerts" on={isOn(pathname, "/notifications")}>
        <BellIcon style={styles.icon} />
        <UnreadBadge />
      </Item>
      <Item href={you} label="You" on={isOn(pathname, you)}>
        <UserIcon style={styles.icon} />
      </Item>

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
    display: { default: "none", [bp.desktop]: "flex" },
    flexDirection: "column",
    gap: 4,
    position: "sticky",
    top: 0,
    paddingTop: "calc(16px + env(safe-area-inset-top))",
    paddingBottom: 24,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingInline: 12,
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
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.75rem",
    lineHeight: 1,
    letterSpacing: "0.01em",
    color: colors.burnt,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minHeight: 48,
    paddingInline: 14,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "1.0625rem",
    color: colors.muted,
    textDecorationLine: "none",
    borderRadius: shape.pill,
    backgroundColor: { default: "transparent", ":hover": colors.chip },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  active: { color: colors.burnt, backgroundColor: colors.surface },
  mark: { position: "relative", display: "grid", placeItems: "center" },
  icon: { width: 24, height: 24 },
  compose: { marginTop: 16, justifyContent: "center" },
  plus: { width: 20, height: 20 },
});
