"use client";

// Save a peel for later. Private: RLS on bookmarks is select-own, so the filled
// mark only ever means "you saved this". Optimistic, like the like chip.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { bookmark, unbookmark } from "@/app/actions";
import { colors } from "@/app/tokens.stylex";
import { Button } from "./button";
import { BookmarkIcon } from "./icons";

export function BookmarkButton({
  peel,
  onOptimisticBookmark,
}: {
  peel: PeelUnionAuthor;
  onOptimisticBookmark: (next: PeelUnionAuthor) => void;
}) {
  const router = useRouter();
  const saved = peel.user_has_bookmarked;

  function toggle() {
    // React 19: the optimistic update has to happen inside a transition, before any await.
    startTransition(async () => {
      onOptimisticBookmark({ ...peel, user_has_bookmarked: !saved });
      // A failure leaves the server state alone, so the refresh puts the mark back.
      await (saved ? unbookmark(peel.id) : bookmark(peel.id));
      router.refresh();
    });
  }

  return (
    <Button
      variant="icon"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove bookmark" : "Bookmark"}
      style={saved ? styles.saved : undefined}
    >
      <BookmarkIcon filled={saved} />
    </Button>
  );
}

const styles = stylex.create({
  // The icon variant is muted with an ink hover; saved is burnt in both states.
  saved: { color: { default: colors.burnt, ":hover": colors.burnt } },
});
