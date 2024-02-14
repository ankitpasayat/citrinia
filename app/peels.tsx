"use client";

import { useEffect, useOptimistic } from "react";
import Likes from "./likes";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Peels({ peels }: { peels: PeelUnionAuthor[] }) {
  const [optimisticPeels, addOptimisticPeel] = useOptimistic<
    PeelUnionAuthor[],
    PeelUnionAuthor
  >(peels, (currentOptimisticPeels, newPeel) => {
    const newOptimisticPeels = [...currentOptimisticPeels];
    const index = newOptimisticPeels.findIndex(
      (peel) => peel.id === newPeel.id
    );
    newOptimisticPeels[index] = newPeel;
    return newOptimisticPeels;
  });

  const supabase = createClientComponentClient();
  const router = useRouter();

  useEffect(() => {
    const channel = supabase
      .channel("realtime peels")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "peels",
        },
        () => {
          router.refresh();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  return optimisticPeels.map((peel) => (
    <div key={peel.id}>
      <Avatar>
        <AvatarImage src={peel.author.avatar_url}></AvatarImage>
        <AvatarFallback>pfp</AvatarFallback>
      </Avatar>
      <p>
        {peel.author.name} {peel.author.username}
      </p>
      <p>{peel.title}</p>
      <Likes peel={peel} addOptimisticPeel={addOptimisticPeel} />
    </div>
  ));
}
