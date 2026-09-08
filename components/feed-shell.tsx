"use client";

// The chrome: whatever the page renders, plus the navigation and the one compose
// sheet they share. Every screen wraps its column in this. A signed-out reader
// gets the same frame with less in it -- Feed and Explore, and Sign in where the
// compose controls were -- so the square looks like itself before you join it.
// Phones get the bottom bar. From the tablet breakpoint the navigation is an
// icon rail on the left with the column centred beside it; from the desktop
// breakpoint the aside joins on the right -- search plus whatever the page hands
// over as `aside` (who to follow, say); from the wide breakpoint the rail grows
// its labels. The three columns add up to 1024 exactly with the icon rail, so
// the feed keeps its 520px on an iPad in landscape.
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
  wide = false,
  children,
}: {
  /** The viewer's handle, for the rail's You. null is a signed-out reader. */
  username: string | null;
  aside?: React.ReactNode;
  /**
   * Give the middle everything the rail does not take, and drop the aside.
   * Messages is the one screen that asks: two panes side by side do not fit in
   * 520px, and search in a third column beside a conversation is a column of
   * nothing to do.
   */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const pathname = usePathname();
  // Inside a conversation the composer owns the bottom edge of a phone, so the
  // bar stands aside. /messages/new is a search screen rather than a
  // conversation, and keeps it.
  const inConversation = pathname.startsWith("/messages/") && pathname !== "/messages/new";

  return (
    <>
      <div {...stylex.props(wide ? styles.shellWide : styles.shell)}>
        <SideNav username={username} onCompose={() => setOpen(true)} />
        <div {...stylex.props(styles.middle)}>{children}</div>
        {/* One style or the other, never both: StyleX orders overlapping media
            rules its own way, and merging two column templates is how the
            desktop rule started winning over the wide one. */}
        {!wide && (
          <aside {...stylex.props(styles.aside)}>
            {/* Explore already leads with its own form. */}
            {pathname !== "/explore" && <SearchForm autoFocus={false} />}
            {aside}
          </aside>
        )}
      </div>
      {!inConversation && <Tabs signedIn={username !== null} onCompose={() => setOpen(true)} />}
      {username !== null && <ComposeSheet open={open} onClose={close} />}
    </>
  );
}

const styles = stylex.create({
  shell: {
    display: { default: "block", [bp.tablet]: "grid" },
    // The middle range is exclusive on purpose: StyleX emits overlapping media
    // rules in an order of its own, and at 1280px the desktop rule was landing
    // after the wide one and winning. A literal, because keys must be constants.
    gridTemplateColumns: {
      default: "76px minmax(0, 1fr)",
      "@media (min-width: 1024px) and (max-width: 1279.98px)": "76px minmax(0, 520px) 300px",
      [bp.wide]: "232px minmax(0, 520px) 300px",
    },
    justifyContent: "center",
    alignItems: "start",
    columnGap: { default: 0, [bp.desktop]: 40 },
    paddingInline: { default: 0, [bp.desktop]: 24 },
  },
  shellWide: {
    display: { default: "block", [bp.tablet]: "grid" },
    gridTemplateColumns: {
      default: "76px minmax(0, 1fr)",
      [bp.wide]: "232px minmax(0, 1fr)",
    },
    justifyContent: "center",
    alignItems: "start",
    columnGap: { default: 0, [bp.desktop]: 32 },
    paddingInline: { default: 0, [bp.desktop]: 24 },
    // Wide, but not endlessly: a conversation stretched across a 27-inch screen
    // is one line of words per paragraph.
    maxWidth: 1240,
    marginInline: "auto",
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
