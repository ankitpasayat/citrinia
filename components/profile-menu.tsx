"use client";

// The dots on somebody else's profile: mute them, block them, or report them.
//
// Blocking is here as well as being a button, because it is only a button on a
// profile you have ALREADY blocked -- where Follow would otherwise sit. The
// first block has to come from somewhere, and a menu is where an app puts the
// choice it does not want anybody making by accident.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { blockUser, muteUser, unmuteUser } from "@/app/actions";
import { BlockConfirm } from "./block-confirm";
import { Button } from "./button";
import { BlockIcon, FlagIcon, MoreIcon, MuteIcon } from "./icons";
import { menuStyles, useMenu } from "./menu";
import { ReportSheet } from "./report-sheet";
import { toast } from "./toast";

type Props = { profileId: string; handle: string; isMuted: boolean };

export function ProfileMenu({ profileId, handle, isMuted }: Props) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
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

  function onBlock() {
    startTransition(async () => {
      const { error } = await blockUser(profileId);
      if (error) {
        toast(error, "bad");
        return;
      }
      setBlocking(false);
      toast(`@${handle} is blocked`);
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
            setBlocking(true);
          }}
          {...stylex.props(menuStyles.item, menuStyles.danger)}
        >
          <BlockIcon />
          Block @{handle}
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

      <BlockConfirm
        handle={handle}
        open={blocking}
        onClose={() => setBlocking(false)}
        onConfirm={onBlock}
      />

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
