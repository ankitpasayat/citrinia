"use client";

// Peach chip, apricot on hover, mustard with a filled wedge when liked. The
// write goes straight from the browser (RLS scopes it to the signed-in user),
// so the count moves before the round trip and the refresh only confirms it.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { bp, colors, fonts, shape } from "@/app/tokens.stylex";
import { createClient } from "@/lib/supabase/client";
import { WedgeIcon } from "./icons";

export function LikeChip({
  peel,
  onOptimisticLike,
}: {
  peel: PeelUnionAuthor;
  onOptimisticLike: (next: PeelUnionAuthor) => void;
}) {
  const router = useRouter();
  // The pop plays on the way to liked, never on the way back.
  const [justLiked, setJustLiked] = useState(false);
  const liked = peel.user_has_liked_peel;

  function toggle() {
    setJustLiked(!liked);
    // React 19: the optimistic update has to happen inside a transition, before any await.
    startTransition(async () => {
      onOptimisticLike({
        ...peel,
        likes: peel.likes + (liked ? -1 : 1),
        user_has_liked_peel: !liked,
      });
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (liked) {
        await supabase.from("likes").delete().match({ user_id: user.id, peel_id: peel.id });
      } else {
        await supabase.from("likes").insert({ user_id: user.id, peel_id: peel.id });
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={`${liked ? "Unlike" : "Like"}, ${peel.likes} likes`}
      {...stylex.props(styles.chip, liked && styles.liked)}
    >
      <span
        {...stylex.props(styles.mark, justLiked && styles.pop)}
        onAnimationEnd={() => setJustLiked(false)}
      >
        <WedgeIcon filled={liked} style={styles.icon} />
      </span>
      <span {...stylex.props(styles.count)}>{peel.likes}</span>
    </button>
  );
}

/** The chip shell, for anything else in the actions row that has to match it (the reply link). */
export const chipStyles = {
  get base() {
    return styles.chip;
  },
};

const pop = stylex.keyframes({
  "0%": { transform: "scale(0.7) rotate(-12deg)" },
  "60%": { transform: "scale(1.25) rotate(6deg)" },
  "100%": { transform: "none" },
});

const styles = stylex.create({
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.8125rem",
    lineHeight: 1,
    color: colors.ink,
    backgroundColor: {
      default: colors.chip,
      [bp.hover]: { default: colors.chip, ":hover": colors.apricot },
    },
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.pill,
    paddingBlock: 8,
    paddingLeft: 10,
    paddingRight: 12,
    cursor: "pointer",
    touchAction: "manipulation",
    transitionProperty: "background-color",
    transitionDuration: { default: "120ms", [bp.reduce]: "0ms" },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  liked: {
    backgroundColor: {
      default: colors.mustard,
      [bp.hover]: { default: colors.mustard, ":hover": colors.mustard },
    },
    color: colors.onStripe,
  },
  mark: { display: "inline-flex" },
  pop: {
    animationName: pop,
    animationDuration: { default: "320ms", [bp.reduce]: "0ms" },
    animationTimingFunction: "cubic-bezier(.2,1.6,.4,1)",
  },
  icon: { width: 18, height: 18 },
  count: { fontVariantNumeric: "tabular-nums" },
});
