"use client";

// The feed body. It owns the optimistic copy of the list so a like, a repeel, a
// bookmark or a delete lands instantly, and (when live) watches for other
// people's peels.
//
// It does not refresh on its own any more. A feed that reorders itself under a
// reader's thumb loses their place, so new peels are announced with a button and
// arrive when it is tapped.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useId, useOptimistic, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { createClient } from "@/lib/supabase/client";
import { ComposeSheet } from "./compose-sheet";
import { EmptyState } from "./empty-state";
import { PeelCard } from "./peel-card";
import { Pill } from "./pill";
import { ShowOlder } from "./show-older";

type Patch = { type: "replace"; peel: PeelUnionAuthor } | { type: "remove"; id: string };

/**
 * A peel can be on the timeline twice -- once as itself, once as somebody's
 * repeel of it -- and those are two rows, not one. The id alone would collide.
 */
function rowKey(peel: PeelUnionAuthor): string {
  return `${peel.id}:${peel.reposted_by?.id ?? ""}`;
}

export function PeelList({
  peels,
  viewerId,
  emptyTitle = "No peels yet",
  emptyBody = "Tap + to peel first.",
  emptyChildren,
  live = true,
  embed = false,
  olderHref,
}: {
  peels: PeelUnionAuthor[];
  viewerId: string;
  emptyTitle?: string;
  emptyBody?: string;
  /** Rendered inside the empty state, under the note (the Following feed's suggestions). */
  emptyChildren?: React.ReactNode;
  /**
   * What the "N new" announcement counts. `true` (the default) is the timeline,
   * i.e. `{ parentId: null }` -- top-level peels only, because replies are not on
   * it. `{ parentId: id }` is a thread's replies. `false` does not listen at all.
   */
  live?: boolean | { parentId: string | null };
  /** The peel page: play YouTube inline instead of showing a still. */
  embed?: boolean;
  /** Where "Show older peels" goes. Omit (or null) when there is no next page. */
  olderHref?: string | null;
}) {
  const [shown, patch] = useOptimistic<PeelUnionAuthor[], Patch>(peels, (current, change) =>
    change.type === "remove"
      ? current.filter((peel) => peel.id !== change.id)
      : current.map((peel) =>
          // Both copies of a peel move together, but each row keeps its own
          // "repeeled by", which is a property of the row and not of the peel.
          peel.id === change.peel.id ? { ...change.peel, reposted_by: peel.reposted_by } : peel,
        ),
  );

  const router = useRouter();
  // Channel names are per-instance: a thread page mounts more than one list.
  const channelId = useId();
  const [waiting, setWaiting] = useState(0);
  const [quoting, setQuoting] = useState<PeelUnionAuthor | null>(null);

  // A new page of peels is the announcement being answered, however it arrived.
  // Adjusted during render rather than in an effect: React re-runs this component
  // before touching the DOM, so the stale count is never painted.
  const [lastPeels, setLastPeels] = useState(peels);
  if (lastPeels !== peels) {
    setLastPeels(peels);
    setWaiting(0);
  }

  // Kept as two primitives so an inline `{ parentId: ... }` object does not
  // resubscribe the channel on every render.
  const listening = live !== false;
  const parentId = typeof live === "object" ? live.parentId : null;

  useEffect(() => {
    if (!listening) return;
    const supabase = createClient();
    let channel: RealtimeChannel | undefined;
    let cancelled = false;

    // The session lives in a cookie, so the socket only learns the viewer's token
    // asynchronously. Subscribing first wins that race and joins as `anon`, and the
    // peels select policy is `to authenticated`, so RLS filters out every change and
    // the feed silently never updates. setAuth() first, subscribe second.
    supabase.realtime
      .setAuth()
      .then(() => {
        if (cancelled) return;
        channel = supabase
          // Only inserts: an edit or a delete elsewhere is not something to
          // interrupt a reader for, and the next navigation picks it up anyway.
          .channel(`peels:${channelId}`)
          .on<{ parent_id: string | null; user_id: string }>(
            "postgres_changes",
            parentId === null
              ? { event: "INSERT", schema: "public", table: "peels" }
              : {
                  event: "INSERT",
                  schema: "public",
                  table: "peels",
                  filter: `parent_id=eq.${parentId}`,
                },
            (payload) => {
              // Realtime filters have no `is null`, so the timeline drops replies
              // here instead -- announcing one would send the reader nowhere.
              if (parentId === null && payload.new.parent_id !== null) return;
              // Your own peel is already on the screen: posting refreshes the
              // list, so announcing it would offer the reader nothing new.
              if (payload.new.user_id === viewerId) return;
              setWaiting((n) => n + 1);
            },
          )
          .subscribe();
      })
      // No token, no channel: the feed still renders and every action still
      // revalidates it, it just stops updating on its own.
      .catch(() => {});

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [listening, parentId, channelId, viewerId]);

  if (shown.length === 0) {
    return (
      <EmptyState title={emptyTitle} body={emptyBody}>
        {emptyChildren}
      </EmptyState>
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      {waiting > 0 && (
        <div {...stylex.props(styles.newRow)}>
          <button
            type="button"
            onClick={() => {
              setWaiting(0);
              router.refresh();
            }}
            {...stylex.props(styles.newButton)}
          >
            <Pill>
              {parentId === null
                ? waiting === 1
                  ? "1 new peel"
                  : `${waiting} new peels`
                : waiting === 1
                  ? "1 new reply"
                  : `${waiting} new replies`}
            </Pill>
          </button>
        </div>
      )}

      {shown.map((peel) => (
        <PeelCard
          key={rowKey(peel)}
          peel={peel}
          viewerId={viewerId}
          embed={embed}
          onOptimisticLike={(next) => patch({ type: "replace", peel: next })}
          onOptimisticRemove={(id) => patch({ type: "remove", id })}
          onOptimisticRepost={(next) => patch({ type: "replace", peel: next })}
          onOptimisticBookmark={(next) => patch({ type: "replace", peel: next })}
          onQuote={setQuoting}
        />
      ))}

      {olderHref && <ShowOlder href={olderHref} />}

      {/* The list's own composer, so a Quote does not need the shell's sheet. */}
      <ComposeSheet
        open={quoting !== null}
        onClose={() => setQuoting(null)}
        quote={quoting ?? undefined}
      />
    </div>
  );
}

const styles = stylex.create({
  stack: { display: "grid", gap: 12 },
  newRow: { display: "flex", justifyContent: "center" },
  newButton: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 44,
    paddingBlock: 0,
    paddingInline: 8,
    fontFamily: fonts.body,
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.pill,
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
});
