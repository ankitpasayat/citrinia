"use client";

// The app's one toast: a live region at the bottom of the column, above the bar,
// gone after three seconds. Anything that happens without moving the reader
// somewhere -- a copied link, a saved setting -- says so here.
//
// A module store rather than a context: the callers are client leaves (a card's
// menu) under server components, and a provider would have to be threaded down
// through every one of them to reach a single element that lives in the layout.
import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";

type Tone = "good" | "bad";
type Message = { id: number; text: string; tone: Tone };

const LIFE = 3000;

let shown: Message | null = null;
let next = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(message: Message | null): void {
  shown = message;
  for (const listener of listeners) listener();
}

/** Say one thing to the reader. A second call replaces the first and restarts the clock. */
export function toast(text: string, tone: Tone = "good"): void {
  clearTimeout(timer);
  publish({ id: next++, text, tone });
  timer = setTimeout(() => publish(null), LIFE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => shown;
// Nothing is announced on the server, and the region is empty on first paint.
const readServer = () => null;

/** Mounted once, in the root layout. */
export function Toaster() {
  const message = useSyncExternalStore(subscribe, read, readServer);

  return (
    // The region is always in the tree: one added at the same moment as its text
    // is not reliably announced, because there was nothing there to change.
    <div role="status" aria-live="polite" {...stylex.props(styles.region)}>
      {message && (
        // Keyed by id, so the same words twice are a new element -- which
        // replays the animation and gives the screen reader a change to read.
        <p key={message.id} {...stylex.props(styles.toast, message.tone === "bad" && styles.bad)}>
          {message.text}
        </p>
      )}
    </div>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(8px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  region: {
    position: "fixed",
    // Over the bottom bar (10), under a popover, which is in the top layer.
    zIndex: 11,
    left: 0,
    right: 0,
    // Clear of the bar, and of the compose button standing 36px proud of it:
    // 18 up, 64 tall, and the button's top edge 116 off the bottom of the
    // screen. From the tablet breakpoint there is no bar to clear at all, so
    // the toast takes the column's own bottom margin instead.
    bottom: {
      default: "calc(128px + env(safe-area-inset-bottom))",
      [bp.tablet]: "calc(24px + env(safe-area-inset-bottom))",
    },
    display: "flex",
    justifyContent: "center",
    paddingInline: 16,
    // Decoration, not a target: it must never eat a tap meant for the page.
    pointerEvents: "none",
  },
  toast: {
    marginBlock: 0,
    marginInline: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
    maxWidth: shape.column,
    paddingBlock: 12,
    paddingInline: 16,
    fontFamily: fonts.body,
    fontWeight: 700,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: shape.field,
    borderLeftWidth: 6,
    borderLeftStyle: "solid",
    borderLeftColor: colors.mustard,
    boxShadow: colors.shadowLg,
    animationName: rise,
    animationDuration: { default: "160ms", [bp.reduce]: "0ms" },
    animationTimingFunction: "ease-out",
  },
  bad: { borderLeftColor: colors.danger },
});
