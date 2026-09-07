"use client";

// The two panes of Messages, and the one media query that decides how many of
// them a screen gets.
//
// Under bp.split the list is /messages and a conversation is /messages/<id>,
// one at a time, with the arrow in the conversation's head as the way back.
// Over it both are on screen at once and the url still says which conversation
// is open -- so a link to a conversation means the same thing at either width,
// and a phone-sized window is not a different app.
//
// Which pane a narrow screen shows is decided by the path rather than by state:
// /messages is the list, and anything below it is a conversation, the picker or
// a blank one. Both panes stay in the document and CSS hides one, so nothing
// re-fetches when a window is resized across the breakpoint.
import * as stylex from "@stylexjs/stylex";
import { usePathname } from "next/navigation";
import { bp, colors } from "@/app/tokens.stylex";

export function MessagesShell({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const onList = pathname === "/messages";

  return (
    <main {...stylex.props(styles.panes, onList && styles.clearsBar)}>
      <section
        aria-label="Conversations"
        {...stylex.props(styles.pane, styles.list, !onList && styles.phoneHidden)}
      >
        {list}
      </section>
      <section
        aria-label="Open conversation"
        {...stylex.props(styles.pane, styles.open, onList && styles.phoneHidden)}
      >
        {children}
      </section>
    </main>
  );
}

const styles = stylex.create({
  panes: {
    display: "grid",
    // The list is a fixed column and the conversation takes the rest, which is
    // the way round that keeps a long message from squeezing the names.
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      [bp.split]: "minmax(0, 320px) minmax(0, 1fr)",
    },
    columnGap: { default: 0, [bp.split]: 20 },
    // The panes fill the height so the conversation's composer can sit on the
    // bottom edge of one.
    alignItems: "stretch",
    minHeight: "100dvh",
    paddingTop: "calc(16px + env(safe-area-inset-top))",
    paddingInline: 16,
    paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
  },
  // Only the list has the bottom bar under it to clear: in a conversation the
  // bar stands aside so the composer can own the bottom edge.
  clearsBar: {
    paddingBottom: {
      default: "calc(124px + env(safe-area-inset-bottom))",
      [bp.tablet]: "calc(24px + env(safe-area-inset-bottom))",
    },
  },
  pane: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  list: {
    // Over the breakpoint the list scrolls in place, so the conversation beside
    // it keeps its composer where the reader last saw it.
    position: { default: "static", [bp.split]: "sticky" },
    top: 0,
    maxHeight: { default: "none", [bp.split]: "100dvh" },
    overflowY: { default: "visible", [bp.split]: "auto" },
    paddingBottom: { default: 0, [bp.split]: 16 },
  },
  open: {
    borderStartStartRadius: 0,
    // A hairline between the panes, and only where there are two of them.
    borderInlineStartWidth: { default: 0, [bp.split]: 1 },
    borderInlineStartStyle: "solid",
    borderInlineStartColor: { default: "transparent", [bp.split]: colors.apricotLip },
    paddingInlineStart: { default: 0, [bp.split]: 20 },
  },
  phoneHidden: { display: { default: "none", [bp.split]: "flex" } },
});
