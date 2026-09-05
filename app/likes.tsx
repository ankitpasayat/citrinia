"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

export default function Likes({
  peel,
  addOptimisticPeel,
}: {
  peel: PeelUnionAuthor;
  addOptimisticPeel: (newPeel: PeelUnionAuthor) => void;
}) {
  const router = useRouter();

  const handleLikes = () => {
    // React 19: optimistic updates must happen inside a transition, and before any await.
    startTransition(async () => {
      const liked = peel.user_has_liked_peel;
      addOptimisticPeel({
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
        await supabase
          .from("likes")
          .delete()
          .match({ user_id: user.id, peel_id: peel.id });
      } else {
        await supabase
          .from("likes")
          .insert({ user_id: user.id, peel_id: peel.id });
      }
      router.refresh();
    });
  };
  return <Button onClick={handleLikes}>{peel.likes} Likes</Button>;
}
