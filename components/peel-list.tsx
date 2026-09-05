"use client";

// The feed body. It owns the optimistic copy of the list so a like or a delete
// lands instantly, and (when live) refreshes the route whenever anyone's peel
// changes so other people's peels arrive without a reload.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useId, useOptimistic } from "react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "./empty-state";
import { PeelCard } from "./peel-card";

type Patch = { type: "like"; peel: PeelUnionAuthor } | { type: "remove"; id: string };

export function PeelList({
  peels,
  viewerId,
  emptyTitle = "No peels yet",
  emptyBody = "Tap + to peel first.",
  live = true,
}: {
  peels: PeelUnionAuthor[];
  viewerId: string;
  emptyTitle?: string;
  emptyBody?: string;
  live?: boolean;
}) {
  const [shown, patch] = useOptimistic<PeelUnionAuthor[], Patch>(peels, (current, change) =>
    change.type === "remove"
      ? current.filter((peel) => peel.id !== change.id)
      : current.map((peel) => (peel.id === change.peel.id ? change.peel : peel)),
  );

  const router = useRouter();
  // Channel names are per-instance: a thread page mounts more than one list.
  const channelId = useId();

  useEffect(() => {
    if (!live) return;
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
          .channel(`peels:${channelId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "peels" }, () => {
            router.refresh();
          })
          .subscribe();
      })
      // No token, no channel: the feed still renders and every action still
      // revalidates it, it just stops updating on its own.
      .catch(() => {});

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [live, channelId, router]);

  if (shown.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;

  return (
    <div {...stylex.props(styles.stack)}>
      {shown.map((peel) => (
        <PeelCard
          key={peel.id}
          peel={peel}
          viewerId={viewerId}
          onOptimisticLike={(next) => patch({ type: "like", peel: next })}
          onOptimisticRemove={(id) => patch({ type: "remove", id })}
        />
      ))}
    </div>
  );
}

const styles = stylex.create({
  stack: { display: "grid", gap: 12 },
});
