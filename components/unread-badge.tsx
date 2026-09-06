"use client";

// The dot on the bell. Counts the viewer's unopened notifications straight from
// the browser client -- RLS on `notifications` is select-own, so the count needs
// no user id and none can leak. Re-counts on every navigation and on every
// change Realtime reports for the viewer's own rows, and clears the moment the
// notifications screen says it marked them read.
import * as stylex from "@stylexjs/stylex";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { createClient } from "@/lib/supabase/client";

import type { RealtimeChannel } from "@supabase/supabase-js";

/** Fired on `window` once the notifications screen has marked everything read. */
export const NOTIFICATIONS_READ_EVENT = "citrinia:notifications-read";

export function UnreadBadge() {
  const pathname = usePathname();
  const channelId = useId();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // `pathname` is the trigger, not an input: every navigation re-counts, so the
    // badge is right for the screen the viewer just landed on.
    void pathname;
    const supabase = createClient();
    let cancelled = false;
    // Every count is numbered, and an answer only lands if nothing has happened
    // since it was asked: opening the notifications screen marks the batch read
    // while a count is still in flight, and that stale answer would put the
    // badge straight back.
    let epoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const recount = () => {
      const mine = ++epoch;
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .then(({ count: unread }) => {
          // A failed count is a missing badge, never a wrong one.
          if (!cancelled && mine === epoch) setCount(unread ?? 0);
        });
    };
    recount();

    const clear = () => {
      epoch++;
      clearTimeout(timer);
      setCount(0);
    };
    window.addEventListener(NOTIFICATIONS_READ_EVENT, clear);

    // Any change to the viewer's rows is one fresh count, never a +1 or -1: an
    // unlike takes its notification with it and that delete carries no read_at,
    // and marking everything read is one update event per row.
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(recount, 250);
    };
    let channel: RealtimeChannel | undefined;
    // The filter needs the viewer's id, which the session cookie already holds.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled || !session) return;
        // setAuth() first, subscribe second, or the socket joins as `anon` and
        // RLS hides every change -- see components/peel-list.tsx.
        return supabase.realtime.setAuth().then(() => {
          if (cancelled) return;
          channel = supabase
            .channel(`notifications:${channelId}`)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${session.user.id}`,
              },
              changed,
            )
            .subscribe();
        });
      })
      // No session or no token, no channel: the badge still counts on every
      // navigation and still clears when the screen is read.
      .catch(() => {});

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, clear);
      if (channel) supabase.removeChannel(channel);
    };
  }, [pathname, channelId]);

  if (count === 0) return null;

  return (
    // `img`, not `status`: the count belongs to the bell's accessible name, and a
    // live region here would announce itself on every single navigation.
    <span
      role="img"
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
      {...stylex.props(styles.badge)}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

const styles = stylex.create({
  badge: {
    position: "absolute",
    top: -5,
    insetInlineEnd: -9,
    display: "grid",
    placeItems: "center",
    minWidth: 17,
    height: 17,
    paddingInline: 4,
    borderRadius: shape.pill,
    backgroundColor: colors.burnt,
    color: colors.onButton,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
  },
});
