import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Messages" };

/**
 * The open-conversation pane with nothing open in it. On a phone this is never
 * seen -- at /messages the list is the screen and this pane is hidden -- so it
 * exists for the split view, where the right-hand side has to say something
 * while the reader decides.
 *
 * The list itself is the layout's, so that it survives moving from one
 * conversation to the next.
 */
export default function NoConversation() {
  return <EmptyState title="Pick a conversation" body="Or start one with the + above the list." />;
}
