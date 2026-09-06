"use client";

// The composer, in a bottom sheet. The counter is live, the button locks when
// there is nothing to post or too much of it, and a clean post closes the sheet.
// It also quotes (the peel rides along under the text) and carries pictures: the
// files go to Storage first and only their urls are posted, so a failed upload
// never leaves half a peel behind.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { addPeel, type ActionResult } from "@/app/actions";
import { remaining } from "@/lib/peel";
import { Button } from "./button";
import { HelpText, Textarea } from "./field";
import { type Attachment, MediaPicker, uploadAttachments } from "./media-picker";
import { Pill } from "./pill";
import { QuoteCard } from "./quote-card";
import { Sheet } from "./sheet";
import { youtubeMedia, youtubeUrlIn } from "./youtube-embed";

export function ComposeSheet({
  open,
  onClose,
  parentId,
  replyingTo,
  quote,
}: {
  open: boolean;
  onClose: () => void;
  parentId?: string;
  /** The handle being replied to, for the sheet title. */
  replyingTo?: string;
  /** The peel this one embeds. Its card shows under the text as a preview. */
  quote?: PeelUnionAuthor;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const router = useRouter();

  // The uploads have to finish before the peel is inserted, so they run inside
  // the action rather than beside it: `pending` then covers the whole thing and
  // the button stays busy for as long as anything is actually happening.
  async function submit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
    if (attachments.length > 0) {
      const uploaded = await uploadAttachments(attachments);
      if ("error" in uploaded) return { error: uploaded.error };
      formData.set("media", JSON.stringify(uploaded.media));
    } else {
      // A YouTube link in the text becomes a player. The link stays in the text:
      // it is what they wrote, and removing words nobody asked us to remove is rude.
      const media = youtubeMedia(String(formData.get("title") ?? ""));
      if (media.length > 0) formData.set("media", JSON.stringify(media));
    }
    return addPeel({}, formData);
  }

  const [state, formAction, pending] = useActionState(submit, {});

  // useActionState cannot tell "not submitted yet" from "submitted fine": both
  // are {}. The edge out of pending with no error is the successful post.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setText("");
      setAttachments([]);
      onClose();
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state, onClose, router]);

  const left = remaining(text);
  const over = left < 0;
  const tube = attachments.length === 0 && youtubeUrlIn(text) !== null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={quote ? "Quote peel" : replyingTo ? `Reply to @${replyingTo}` : "New peel"}
    >
      <form action={formAction}>
        {parentId && <input type="hidden" name="parent_id" value={parentId} />}
        {quote && <input type="hidden" name="quote_id" value={quote.id} />}
        <Textarea
          name="title"
          rows={4}
          autoFocus
          onSurface
          invalid={over}
          placeholder="how are you peeling?"
          aria-label={quote ? "Your quote" : replyingTo ? "Your reply" : "Your peel"}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {quote && (
          <div {...stylex.props(styles.quote)}>
            <QuoteCard quote={quote} linked={false} />
          </div>
        )}
        <MediaPicker items={attachments} onChange={setAttachments} disabled={pending} />
        {tube && (
          <p {...stylex.props(styles.tube)}>
            <Pill>YouTube attached</Pill>
          </p>
        )}
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
  quote: { marginTop: 10 },
  tube: { margin: 0, marginTop: 8 },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
  buttons: { display: "flex", alignItems: "center", gap: 10 },
});
