"use client";

// The bottom bar: Feed, Explore, the compose button, Alerts, You. Fixed to the
// viewport, inset to the column's gutters. Phones only: from the tablet
// breakpoint the side rail (side-nav.tsx) takes over and this hides.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Button } from "./button";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { UnreadBadge } from "./unread-badge";

/** A prefix only counts at a path boundary: `/u/ada` is not inside `/u/adam`. */
export function isOn(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Tabs({ username, onCompose }: { username: string; onCompose: () => void }) {
  const pathname = usePathname();
  const you = `/u/${username}`;

  return (
    <nav {...stylex.props(styles.bar)} aria-label="Main">
      <Tab href="/" label="Feed" on={isOn(pathname, "/")}>
        <HomeIcon style={styles.icon} />
      </Tab>

      <Tab href="/explore" label="Explore" on={isOn(pathname, "/explore")}>
        <SearchIcon style={styles.icon} />
      </Tab>

      <Button variant="fab" aria-label="New peel" onClick={onCompose} style={styles.fab}>
        <PlusIcon style={styles.plus} />
      </Button>

      <Tab href="/notifications" label="Alerts" on={isOn(pathname, "/notifications")}>
        <BellIcon style={styles.icon} />
        <UnreadBadge />
      </Tab>

      <Tab href={you} label="You" on={isOn(pathname, you)}>
        <UserIcon style={styles.icon} />
      </Tab>
    </nav>
  );
}

/** One slot. `children` is the icon, plus whatever wants to sit on it. */
function Tab({
  href,
  label,
  on,
  children,
}: {
  href: string;
  label: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      {...stylex.props(styles.tab, on && styles.active)}
    >
      {/* Positioned, so the unread badge can hang off the icon rather than the whole tab. */}
      <span {...stylex.props(styles.mark)}>{children}</span>
      {label}
    </Link>
  );
}

const styles = stylex.create({
  bar: {
    display: { default: "grid", [bp.tablet]: "none" },
    position: "fixed",
    zIndex: 10,
    bottom: "calc(18px + env(safe-area-inset-bottom))",
    left: 16,
    right: 16,
    height: 64,
    gridTemplateColumns: "1fr 1fr 76px 1fr 1fr",
    alignItems: "center",
    paddingInline: 8,
    backgroundColor: colors.surface,
    borderRadius: shape.pill,
    boxShadow: colors.shadowLg,
  },
  tab: {
    display: "grid",
    gap: 4,
    justifyItems: "center",
    alignContent: "center",
    minHeight: 48,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    color: colors.muted,
    textAlign: "center",
    textDecorationLine: "none",
    borderRadius: shape.pill,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  active: { color: colors.burnt },
  mark: { position: "relative", display: "grid", placeItems: "center" },
  icon: { width: 22, height: 22 },
  fab: { justifySelf: "center", marginTop: -36 },
  plus: { width: 28, height: 28 },
});
