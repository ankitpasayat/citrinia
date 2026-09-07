"use client";

// The button at the end of a row in /settings/muted. Unmuting takes the row off
// the list, so there is nothing to flip optimistically the way Follow does --
// the button goes quiet until the refresh lands and the row leaves with it.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { unmuteUser } from "@/app/actions";
import { Button } from "./button";
import { toast } from "./toast";

export function UnmuteButton({ profileId, handle }: { profileId: string; handle: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      aria-label={`Unmute @${handle}`}
      onClick={() =>
        start(async () => {
          const { error } = await unmuteUser(profileId);
          if (error) {
            toast(error, "bad");
            return;
          }
          toast(`You'll see @${handle} again`);
          router.refresh();
        })
      }
    >
      Unmute
    </Button>
  );
}
