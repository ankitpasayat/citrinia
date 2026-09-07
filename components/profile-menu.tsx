"use client";

// The dots on somebody else's profile. One row today -- report them -- and the
// place block and mute will go.
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "./button";
import { FlagIcon, MoreIcon } from "./icons";
import { menuStyles, useMenu } from "./menu";
import { ReportSheet } from "./report-sheet";

export function ProfileMenu({ profileId, handle }: { profileId: string; handle: string }) {
  const [reporting, setReporting] = useState(false);
  const { menuId, trigger, menu, pos, onToggle, close } = useMenu();

  return (
    <>
      <Button ref={trigger} variant="icon" aria-label={`More for @${handle}`} popoverTarget={menuId}>
        <MoreIcon />
      </Button>

      <div ref={menu} id={menuId} popover="auto" onToggle={onToggle} {...stylex.props(menuStyles.menu)} style={pos}>
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
