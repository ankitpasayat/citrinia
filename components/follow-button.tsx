"use client";

// Follow / Following. The label flips optimistically inside the transition that
// runs the server action, so the tap feels instant; a failure snaps it back
// (useOptimistic discards the guess when the transition ends) and says why.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useState } from "react";
import { followUser, unfollowUser } from "@/app/actions";
import { Button } from "./button";
import { HelpText } from "./field";

export function FollowButton({ profileId, isFollowing }: { profileId: string; isFollowing: boolean }) {
  const router = useRouter();
  const [following, setFollowing] = useOptimistic(isFollowing);
  const [error, setError] = useState<string>();

  function toggle() {
    startTransition(async () => {
      setFollowing(!following);
      setError(undefined);
      const { error: failed } = following ? await unfollowUser(profileId) : await followUser(profileId);
      if (failed) {
        setError(failed);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <Button
        variant={following ? "secondary" : "primary"}
        aria-pressed={following}
        onClick={toggle}
      >
        {following ? "Following" : "Follow"}
      </Button>
      {error && <HelpText error>{error}</HelpText>}
    </div>
  );
}

const styles = stylex.create({
  wrap: { display: "grid", justifyItems: "start", gap: 2 },
});
