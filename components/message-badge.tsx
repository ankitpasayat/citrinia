"use client";

// The count on the envelope. Same shape as the bell's badge next to it: re-count
// on every navigation, on every message Realtime reports, and whenever a
// conversation says it has been read.
//
// It counts the rows rather than asking the database for a number, because the
// rule for "unread" is lib/messages.ts's and there is deliberately no second
// copy of it in SQL. RLS hands over the viewer's conversations and nobody
// else's, so what arrives is exactly what the list shows -- requests included,
// and unreadCount() is what leaves them out.
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { unreadCount } from "@/lib/messages";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "./badge";

/** Fired on `window` once an open conversation has been marked read. */
export const MESSAGES_READ_EVENT = "citrinia:messages-read";

export function MessageBadge() {
  const pathname = usePathname();
  const channelId = useId();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // `pathname` is the trigger, not an input: every navigation re-counts, so
    // the badge is still right on a browser that never got a socket.
    void pathname;
    const supabase = createClient();
    let cancelled = false;
    // Every count is numbered, so an answer that was overtaken while in flight
    // is dropped rather than putting a stale number back on the screen.
    let epoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The viewer's own id is needed here, unlike the bell's: a conversation row
    // is the same row for both people in it, and which side you are decides
    // whether it is unread.
    let viewerId: string | null = null;

    const recount = () => {
      if (!viewerId) return;
      const mine = ++epoch;
      const me = viewerId;
      // ponytail: every conversation, not a page of them. The rows are small and
      // there is one per person you have talked to; past a few hundred this
      // wants a count in SQL, and then the unread rule has to live there too.
      void supabase
        .from("conversations")
        .select("*")
        .then(({ data }) => {
          // A failed count is a missing badge, never a wrong one.
          if (!cancelled && mine === epoch) setCount(unreadCount(data ?? [], me));
        });
    };

    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(recount, 250);
    };
    window.addEventListener(MESSAGES_READ_EVENT, later);

    let channel: RealtimeChannel | undefined;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled || !session) return;
        viewerId = session.user.id;
        recount();

        // No filter: the messages policy already limits what a subscriber is
        // told to the conversations they are in, so "every insert" arrives
        // meaning "every insert that concerns me". setAuth() first, subscribe
        // second, or the socket joins as `anon` and hears nothing at all.
        return supabase.realtime.setAuth().then(() => {
          if (cancelled) return;
          channel = supabase
            .channel(`messages:${channelId}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, later)
            .subscribe();
        });
      })
      // No session or no token, no channel and no count: signed out, there is
      // nothing to badge.
      .catch(() => {});

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(MESSAGES_READ_EVENT, later);
      if (channel) supabase.removeChannel(channel);
    };
  }, [pathname, channelId]);

  return <Badge count={count} label={(n) => `${n} unread conversation${n === 1 ? "" : "s"}`} />;
}
