"use client";

// The inline reply box under a peel. Same rules as the compose sheet, minus the
// sheet and minus the file picker (a reply with a picture is a peel; use the +):
// post, clear, and let the revalidated thread show the new reply.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { addPeel, type ActionResult } from "@/app/actions";
import { colors, shape } from "@/app/tokens.stylex";
import { remaining } from "@/lib/peel";
import { Button } from "./button";
import { HelpText, Textarea } from "./field";
import { Pill } from "./pill";
import { youtubeMedia, youtubeUrlIn } from "./youtube-embed";

export function ReplyComposer({ parentId, replyingTo }: { parentId: string; replyingTo: string }) {
  const [text, setText] = useState("");
  const router = useRouter();

  // A YouTube link in the text becomes a player. The link stays in the text: it
  // is what they wrote, and removing words nobody asked us to remove is rude.
  async function submit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
    const media = youtubeMedia(String(formData.get("title") ?? ""));
    if (media.length > 0) formData.set("media", JSON.stringify(media));
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
      <Textarea
        name="title"
        rows={3}
        onSurface
        invalid={over}
        placeholder="how are you peeling?"
        aria-label={`Reply to @${replyingTo}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
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
