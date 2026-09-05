"use client";

// The signed-in chrome: whatever the page renders, plus the tab bar and the one
// compose sheet they share. Every signed-in screen wraps its column in this.
import { useCallback, useState } from "react";
import { ComposeSheet } from "./compose-sheet";
import { Tabs } from "./tabs";

export function FeedShell({ username, children }: { username: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {children}
      <Tabs username={username} onCompose={() => setOpen(true)} />
      <ComposeSheet open={open} onClose={close} />
    </>
  );
}
