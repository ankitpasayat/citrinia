"use client";

// The inline reply box under a peel. Same rules as the compose sheet, minus the
// sheet, minus the file picker (a reply with a picture is a peel; use the +) and
// minus the thread: a chain is composed somewhere you can see all of it at once.
// The @ list is here too -- answering somebody is when you pull a third person in.
// Post, clear, and let the revalidated thread show the new reply.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { addPeel, type ActionResult } from "@/app/actions";
import { colors, shape } from "@/app/tokens.stylex";
import { remaining } from "@/lib/peel";
import { Button } from "./button";
import { HelpText } from "./field";
import { MentionBox } from "./mention-box";
import { Pill } from "./pill";
import { youtubeMedia, youtubeUrlIn } from "./youtube-embed";

export function ReplyComposer({ parentId, replyingTo }: { parentId: string; replyingTo: string }) {
  const [text, setText] = useState("");
  const router = useRouter();

  // A YouTube link in the text becomes a player. The link stays in the text: it
  // is what they wrote, and removing words nobody asked us to remove is rude.
  //
  // One box is a thread of one, and it goes up the same way, so there is a
  // single shape on the wire and a single gate on the other side of it.
  async function submit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
    formData.set("items", JSON.stringify([{ title: text, media: youtubeMedia(text) }]));
    return addPeel({}, formData);
  }

  const [state, formAction, pending] = useActionState(submit, {});

  // {} is both "untouched" and "posted fine"; the edge out of pending tells them apart.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setText("");
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state, router]);

  const left = remaining(text);
  const over = left < 0;

  return (
    <form action={formAction} {...stylex.props(styles.card)}>
      <input type="hidden" name="parent_id" value={parentId} />
      <MentionBox
        rows={3}
        onSurface
        invalid={over}
        placeholder="how are you peeling?"
        aria-label={`Reply to @${replyingTo}`}
        value={text}
        onChange={setText}
      />
      {youtubeUrlIn(text) !== null && (
        <p {...stylex.props(styles.tube)}>
          <Pill>YouTube attached</Pill>
        </p>
      )}
      {state.error && <HelpText error>{state.error}</HelpText>}
      <div {...stylex.props(styles.foot)}>
        <Pill tone={over ? "danger" : left < 20 ? "amber" : "mustard"}>
          {over ? `${-left} over` : `${left} left`}
        </Pill>
        <Button type="submit" size="sm" loading={pending} disabled={text.trim() === "" || over}>
          Peel it
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 16,
    paddingInline: 16,
  },
  tube: { margin: 0, marginTop: 8 },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
});
