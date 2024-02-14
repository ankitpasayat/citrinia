"use client";

import { Button } from "@/components/ui/button";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";

export default function Likes({
  peel,
  addOptimisticPeel,
}: {
  peel: PeelUnionAuthor;
  addOptimisticPeel: (newPeel: PeelUnionAuthor) => void;
}) {
  const router = useRouter();

  const handeLikes = async () => {
    const supabase = createClientComponentClient<Database>();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      if (peel.user_has_liked_peel) {
        addOptimisticPeel({
          ...peel,
          likes: peel.likes - 1,
          user_has_liked_peel: !peel.user_has_liked_peel,
        });
        await supabase
          .from("likes")
          .delete()
          .match({ user_id: user.id, peel_id: peel.id });
      } else {
        addOptimisticPeel({
          ...peel,
          likes: peel.likes + 1,
          user_has_liked_peel: !peel.user_has_liked_peel,
        });
        await supabase
          .from("likes")
          .insert({ user_id: user.id, peel_id: peel.id });
      }
      router.refresh();
    }
  };
  return <Button onClick={handeLikes}>{peel.likes} Likes</Button>;
}
