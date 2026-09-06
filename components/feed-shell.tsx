"use client";

// The signed-in chrome: whatever the page renders, plus the navigation and the
// one compose sheet they share. Every signed-in screen wraps its column in this.
// Phones and tablets get the bottom bar; from the desktop breakpoint the page
// becomes three columns -- a rail with the navigation and compose on the left,
// the same column in the middle, and search plus whatever the page hands over
// as `aside` (who to follow, say) on the right.
import * as stylex from "@stylexjs/stylex";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { bp } from "@/app/tokens.stylex";
import { ComposeSheet } from "./compose-sheet";
import { SearchForm } from "./search-form";
import { SideNav } from "./side-nav";
import { Tabs } from "./tabs";

export function FeedShell({
  username,
  aside,
  children,
}: {
  username: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const pathname = usePathname();

  return (
    <>
      <div {...stylex.props(styles.shell)}>
        <SideNav username={username} onCompose={() => setOpen(true)} />
        <div {...stylex.props(styles.middle)}>{children}</div>
        <aside {...stylex.props(styles.aside)}>
          {/* The search screen already leads with its own form. */}
          {pathname !== "/search" && <SearchForm autoFocus={false} />}
          {aside}
        </aside>
      </div>
      <Tabs username={username} onCompose={() => setOpen(true)} />
      <ComposeSheet open={open} onClose={close} />
    </>
  );
}

const styles = stylex.create({
  shell: {
    display: { default: "block", [bp.desktop]: "grid" },
    gridTemplateColumns: "232px minmax(0, 520px) 300px",
    justifyContent: "center",
    alignItems: "start",
    columnGap: 40,
    paddingInline: { default: 0, [bp.desktop]: 24 },
  },
  middle: { minWidth: 0 },
  aside: {
    display: { default: "none", [bp.desktop]: "grid" },
    gap: 16,
    position: "sticky",
    top: 0,
    paddingTop: "calc(16px + env(safe-area-inset-top))",
  },
});
