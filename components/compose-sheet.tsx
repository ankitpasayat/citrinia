"use client";

// The composer, in a bottom sheet. The counter is live, the button locks when
// there is nothing to post or too much of it, and a clean post closes the sheet.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { addPeel } from "@/app/actions";
import { remaining } from "@/lib/peel";
import { Button } from "./button";
import { HelpText, Textarea } from "./field";
import { Pill } from "./pill";
import { Sheet } from "./sheet";

export function ComposeSheet({
  open,
  onClose,
  parentId,
  replyingTo,
}: {
  open: boolean;
  onClose: () => void;
  parentId?: string;
  /** The handle being replied to, for the sheet title. */
  replyingTo?: string;
}) {
  const [state, formAction, pending] = useActionState(addPeel, {});
  const [text, setText] = useState("");
  const router = useRouter();

  // useActionState cannot tell "not submitted yet" from "submitted fine": both
  // are {}. The edge out of pending with no error is the successful post.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setText("");
      onClose();
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state, onClose, router]);

  const left = remaining(text);
  const over = left < 0;

  return (
    <Sheet open={open} onClose={onClose} title={replyingTo ? `Reply to @${replyingTo}` : "New peel"}>
      <form action={formAction}>
        {parentId && <input type="hidden" name="parent_id" value={parentId} />}
        <Textarea
          name="title"
          rows={4}
          autoFocus
          onSurface
          invalid={over}
          placeholder="how are you peeling?"
          aria-label={replyingTo ? "Your reply" : "Your peel"}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {state.error && <HelpText error>{state.error}</HelpText>}
        <div {...stylex.props(styles.foot)}>
          <Pill tone={over ? "danger" : left < 20 ? "amber" : "mustard"}>
            {over ? `${-left} over` : `${left} left`}
          </Pill>
          <div {...stylex.props(styles.buttons)}>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={text.trim() === "" || over}>
              Peel it
            </Button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

const styles = stylex.create({
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
  buttons: { display: "flex", alignItems: "center", gap: 10 },
});
