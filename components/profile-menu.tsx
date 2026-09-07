"use client";

// The dots on somebody else's profile: mute them, or report them. Block joins
// this list next.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { muteUser, unmuteUser } from "@/app/actions";
import { Button } from "./button";
import { FlagIcon, MoreIcon, MuteIcon } from "./icons";
import { menuStyles, useMenu } from "./menu";
import { ReportSheet } from "./report-sheet";
import { toast } from "./toast";

type Props = { profileId: string; handle: string; isMuted: boolean };

export function ProfileMenu({ profileId, handle, isMuted }: Props) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const { menuId, trigger, menu, pos, onToggle, close } = useMenu();

  function onMute() {
    close();
    startTransition(async () => {
      const { error } = isMuted ? await unmuteUser(profileId) : await muteUser(profileId);
      if (error) {
        toast(error, "bad");
        return;
      }
      // "You won't see" rather than "muted": the wording is the promise, and it
      // is also the one thing that tells them the mute is one-sided and quiet.
      toast(isMuted ? `You'll see @${handle} again` : `You won't see @${handle}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button ref={trigger} variant="icon" aria-label={`More for @${handle}`} popoverTarget={menuId}>
        <MoreIcon />
      </Button>

      <div ref={menu} id={menuId} popover="auto" onToggle={onToggle} {...stylex.props(menuStyles.menu)} style={pos}>
        <button type="button" onClick={onMute} {...stylex.props(menuStyles.item)}>
          <MuteIcon />
          {isMuted ? `Unmute @${handle}` : `Mute @${handle}`}
        </button>

        <button
          type="button"
          onClick={() => {
            close();
            setReporting(true);
          }}
          {...stylex.props(menuStyles.item)}
        >
          <FlagIcon />
          Report @{handle}
        </button>
      </div>

      {reporting && (
        <ReportSheet
          subject={{ kind: "profile", id: profileId, handle }}
          open
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
