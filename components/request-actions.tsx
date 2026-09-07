"use client";

// What to do about a message from somebody you do not follow: keep it, bin it,
// or stop them. Shown at the end of a row on the Requests tab and above the
// conversation itself, so the choice is wherever the request is.
//
// Answering it accepts it too -- that is bump_conversation()'s doing, not this
// file's -- so these are the buttons for somebody who has decided before they
// have replied.
import * as stylex from "@stylexjs/stylex";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { acceptRequest, deleteRequest } from "@/app/actions";
import { BlockButton } from "./block-button";
import { Button } from "./button";
import { toast } from "./toast";

export function RequestActions({
  conversationId,
  profileId,
  handle,
}: {
  conversationId: string;
  profileId: string;
  handle: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function run(what: "accept" | "delete") {
    start(async () => {
      const { error } =
        what === "accept" ? await acceptRequest(conversationId) : await deleteRequest(conversationId);
      if (error) {
        toast(error, "bad");
        return;
      }
      toast(what === "accept" ? `You'll hear from @${handle}` : "Request deleted");
      // Accepting moves the row to the inbox and deleting takes it away; either
      // way the screen this button is on no longer says the truth. A deleted
      // conversation cannot be the screen you are left standing on.
      if (what === "delete" && pathname !== "/messages") router.push("/messages");
      else router.refresh();
    });
  }

  return (
    <div {...stylex.props(styles.row)}>
      <Button size="sm" disabled={pending} onClick={() => run("accept")}>
        Accept
      </Button>
      <Button variant="tertiary" size="sm" disabled={pending} onClick={() => run("delete")}>
        Delete
      </Button>
      <BlockButton profileId={profileId} handle={handle} isBlocked={false} compact />
    </div>
  );
}

const styles = stylex.create({
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
