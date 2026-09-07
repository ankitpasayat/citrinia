"use client";

// The composer, in a bottom sheet. One box to start with, and a "+" that grows
// another: a thread is boxes that go up as a chain, each a reply to the one
// before. Every box has its own counter and its own pictures, because they are
// separate peels and only look like one form.
//
// "Peel all" sends the lot to addPeel(), which posts them in a single
// transaction -- a thread arrives whole or not at all, so there is no half a
// thread to tidy up after. A clean post closes the sheet.
//
// It also quotes (the peel rides along under the first box) and carries
// pictures: the files go to Storage first and only their urls are posted, so a
// failed upload never leaves half a peel behind. A quote does not thread: the
// card would repeat down the chain, which is not a thing anybody wants.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { addPeel, type ActionResult } from "@/app/actions";
import { colors } from "@/app/tokens.stylex";
import { remaining } from "@/lib/peel";
import { MAX_THREAD } from "@/lib/thread";
import { Button } from "./button";
import { HelpText } from "./field";
import { PlusIcon } from "./icons";
import { MentionBox } from "./mention-box";
import { type Attachment, MediaPicker, uploadAttachments } from "./media-picker";
import { Pill } from "./pill";
import { QuoteCard } from "./quote-card";
import { Sheet } from "./sheet";
import { youtubeMedia, youtubeUrlIn } from "./youtube-embed";

/** One box: what is typed in it and what is attached to it. */
type Box = { id: number; text: string; attachments: Attachment[] };

// Boxes are added and removed, so their React key has to be theirs rather than
// their position -- an index key hands a removed box's picker state to whichever
// box slides up into its place.
let nextBoxId = 0;
const emptyBox = (): Box => ({ id: nextBoxId++, text: "", attachments: [] });

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
  const [boxes, setBoxes] = useState<Box[]>(() => [emptyBox()]);
  const router = useRouter();

  const patch = (at: number, change: Partial<Box>) =>
    setBoxes((current) => current.map((box, index) => (index === at ? { ...box, ...change } : box)));

  // The uploads have to finish before the peels are inserted, so they run inside
  // the action rather than beside it: `pending` then covers the whole thing and
  // the button stays busy for as long as anything is actually happening.
  async function submit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
    const items = [];
    for (const box of boxes) {
      let media: PeelMedia[];
      if (box.attachments.length > 0) {
        // An upload that fails part-way through a thread leaves the files from
        // the boxes before it in the bucket with no peel pointing at them. The
        // nightly sweep (scripts/sweep-media.mjs) is what collects those, the
        // same as for a single peel whose insert fails.
        const uploaded = await uploadAttachments(box.attachments);
        if ("error" in uploaded) return { error: uploaded.error };
        media = uploaded.media;
      } else {
        // A YouTube link in the text becomes a player. The link stays in the text:
        // it is what they wrote, and removing words nobody asked us to remove is rude.
        media = youtubeMedia(box.text);
      }
      items.push({ title: box.text, media });
    }
    formData.set("items", JSON.stringify(items));
    return addPeel({}, formData);
  }

  const [state, formAction, pending] = useActionState(submit, {});

  // useActionState cannot tell "not submitted yet" from "submitted fine": both
  // are {}. The edge out of pending with no error is the successful post.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setBoxes([emptyBox()]);
      onClose();
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state, onClose, router]);

  // A quote embeds one peel, so it stays one peel.
  const threadable = quote === undefined;
  const unfinished = boxes.some((box) => box.text.trim() === "" || remaining(box.text) < 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={quote ? "Quote peel" : replyingTo ? `Reply to @${replyingTo}` : "New peel"}
    >
      <form action={formAction}>
        {parentId && <input type="hidden" name="parent_id" value={parentId} />}
        {quote && <input type="hidden" name="quote_id" value={quote.id} />}

        {boxes.map((box, at) => {
          const left = remaining(box.text);
          const over = left < 0;
          const tube = box.attachments.length === 0 && youtubeUrlIn(box.text) !== null;
          return (
            <div key={box.id} {...stylex.props(at > 0 && styles.later)}>
              <MentionBox
                rows={4}
                autoFocus={at === 0}
                onSurface
                invalid={over}
                placeholder={at === 0 ? "how are you peeling?" : "and then..."}
                aria-label={
                  at > 0 ? `Peel ${at + 1}` : quote ? "Your quote" : replyingTo ? "Your reply" : "Your peel"
                }
                value={box.text}
                onChange={(text) => patch(at, { text })}
              />
              {quote && at === 0 && (
                <div {...stylex.props(styles.quote)}>
                  <QuoteCard quote={quote} linked={false} />
                </div>
              )}
              <MediaPicker
                items={box.attachments}
                onChange={(attachments) => patch(at, { attachments })}
                disabled={pending}
              />
              {tube && (
                <p {...stylex.props(styles.tube)}>
                  <Pill>YouTube attached</Pill>
                </p>
              )}
              <div {...stylex.props(styles.boxFoot)}>
                <Pill tone={over ? "danger" : left < 20 ? "amber" : "mustard"}>
                  {over ? `${-left} over` : `${left} left`}
                </Pill>
                {boxes.length > 1 && (
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={pending}
                    aria-label={`Remove peel ${at + 1}`}
                    onClick={() => setBoxes((current) => current.filter((_, index) => index !== at))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {threadable && (
          <div {...stylex.props(styles.add)}>
            <Button
              variant="tertiary"
              size="sm"
              disabled={pending || boxes.length >= MAX_THREAD}
              onClick={() => setBoxes((current) => [...current, emptyBox()])}
            >
              <PlusIcon aria-hidden="true" /> Add another
            </Button>
          </div>
        )}

        {state.error && <HelpText error>{state.error}</HelpText>}
        <div {...stylex.props(styles.foot)}>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={unfinished}>
            {boxes.length > 1 ? "Peel all" : "Peel it"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

const styles = stylex.create({
  quote: { marginTop: 10 },
  tube: { margin: 0, marginTop: 8 },
  // A rule above every box after the first, so the chain reads as a chain
  // rather than as one form that grew.
  later: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.chip,
  },
  boxFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 10,
  },
  add: { marginTop: 12 },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
});
