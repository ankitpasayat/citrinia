"use client";

// The bottom bar: Feed, the compose button, You. Fixed to the viewport but sized
// to the column, so it lines up with the content at every width.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { Button } from "./button";
import { HomeIcon, PlusIcon, UserIcon } from "./icons";

export function Tabs({ username, onCompose }: { username: string; onCompose: () => void }) {
  const pathname = usePathname();
  const you = `/u/${username}`;

  return (
    <nav {...stylex.props(styles.bar)} aria-label="Main">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        {...stylex.props(styles.tab, pathname === "/" && styles.active)}
      >
        <HomeIcon style={styles.icon} />
        Feed
      </Link>

      <Button variant="fab" aria-label="New peel" onClick={onCompose} style={styles.fab}>
        <PlusIcon style={styles.plus} />
      </Button>

      <Link
        href={you}
        aria-current={pathname === you ? "page" : undefined}
        {...stylex.props(styles.tab, pathname === you && styles.active)}
      >
        <UserIcon style={styles.icon} />
        You
      </Link>
    </nav>
  );
}

const styles = stylex.create({
  bar: {
    position: "fixed",
    zIndex: 10,
    bottom: "calc(18px + env(safe-area-inset-bottom))",
    left: { default: 16, [bp.tablet]: "50%" },
    right: { default: 16, [bp.tablet]: "auto" },
    width: { default: "auto", [bp.tablet]: shape.column },
    transform: { default: "none", [bp.tablet]: "translateX(-50%)" },
    height: 64,
    display: "grid",
    gridTemplateColumns: "1fr 76px 1fr",
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
    fontSize: "0.75rem",
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
  icon: { width: 22, height: 22 },
  fab: { justifySelf: "center", marginTop: -36 },
  plus: { width: 28, height: 28 },
});
