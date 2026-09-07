"use client";

// Block and unblock, wherever the choice is a button rather than a menu row:
// in place of Follow on a profile you have blocked, and at the end of a row in
// /settings/blocked.
//
// Blocking asks first. It is the only thing here that changes what somebody else
// can see, it drops both follows on the way, and unblocking does not put them
// back -- so a mis-tap costs more than it does anywhere else in the app.
// Unblocking asks nothing: it only ever gives something back.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { blockUser, unblockUser } from "@/app/actions";
import { BlockConfirm } from "./block-confirm";
import { Button } from "./button";
import { toast } from "./toast";

type Props = { profileId: string; handle: string; isBlocked: boolean; compact?: boolean };

export function BlockButton({ profileId, handle, isBlocked, compact = false }: Props) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const { error } = isBlocked ? await unblockUser(profileId) : await blockUser(profileId);
      if (error) {
        toast(error, "bad");
        return;
      }
      setAsking(false);
      toast(isBlocked ? `@${handle} is unblocked` : `@${handle} is blocked`);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size={compact ? "sm" : "md"}
        disabled={pending}
        onClick={() => (isBlocked ? run() : setAsking(true))}
      >
        {isBlocked ? "Unblock" : "Block"}
      </Button>

      <BlockConfirm
        handle={handle}
        open={asking}
        pending={pending}
        onClose={() => setAsking(false)}
        onConfirm={run}
      />
    </>
  );
}
