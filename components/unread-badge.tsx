"use client";

// The dot on the bell. Counts the viewer's unopened notifications straight from
// the browser client -- RLS on `notifications` is select-own, so no user id is
// needed here and none can leak. Re-counts on every navigation, and clears the
// moment the notifications screen says it marked them read.
import * as stylex from "@stylexjs/stylex";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { createClient } from "@/lib/supabase/client";

/** Fired on `window` once the notifications screen has marked everything read. */
export const NOTIFICATIONS_READ_EVENT = "citrinia:notifications-read";

export function UnreadBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // `pathname` is the trigger, not an input: every navigation re-counts, so the
    // badge is right for the screen the viewer just landed on.
    void pathname;
    const supabase = createClient();
    let live = true;

    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .then(({ count: unread }) => {
        // A failed count is a missing badge, never a wrong one.
        if (live) setCount(unread ?? 0);
      });

    // `live` here too: opening the notifications screen marks the batch read
    // while this count is still in flight, and the answer to a question asked
    // before that would put the badge straight back.
    const clear = () => {
      live = false;
      setCount(0);
    };
    window.addEventListener(NOTIFICATIONS_READ_EVENT, clear);
    return () => {
      live = false;
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, clear);
    };
  }, [pathname]);

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
