"use client";

// The one report sheet, opened from a peel's menu and from a profile's. Only
// its subject changes, so only the title and the hidden id do.
//
// Nobody sees what happens next: the reports table has no screen and no select
// policy, and a second report of the same thing is swallowed as "already said".
// So the sheet's whole job is to be honest about that -- it says we will look,
// which is true, and does not pretend anything moved.
import * as stylex from "@stylexjs/stylex";
import { useActionState, useId, useState } from "react";
import { reportContent, type ActionResult } from "@/app/actions";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { MAX_NOTE, REASONS, type Reason } from "@/lib/report";
import { Button } from "./button";
import { HelpText, Textarea } from "./field";
import { Sheet } from "./sheet";
import { toast } from "./toast";

export type ReportSubject =
  | { kind: "peel"; id: string; author: string }
  | { kind: "profile"; id: string; handle: string };

export function ReportSheet({
  subject,
  open,
  onClose,
}: {
  subject: ReportSubject;
  open: boolean;
  onClose: () => void;
}) {
  const groupId = useId();
  const noteId = useId();
  const [reason, setReason] = useState<Reason | null>(null);

  const [state, formAction, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    const result = await reportContent(prev, formData);
    if (!result.error) {
      // The same sentence whether this was the first report or the fifth: the
      // queue is not something a reporter gets to watch.
      toast("Thanks, we'll take a look");
      setReason(null);
      onClose();
    }
    return result;
  }, {} as ActionResult);

  const title = subject.kind === "peel" ? "Report this peel" : `Report @${subject.handle}`;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form action={formAction}>
        <input
          type="hidden"
          name={subject.kind === "peel" ? "peel_id" : "profile_id"}
          value={subject.id}
        />

        {/* A real radio group, so arrow keys move between the reasons and the
            form carries the choice. The dot IS the input -- `appearance: none`
            and a border -- rather than a span drawn over a hidden one, which
            leaves nothing between a pointer and the control it is aiming at. */}
        <div role="radiogroup" aria-labelledby={groupId} {...stylex.props(styles.stack)}>
          <span id={groupId} hidden>
            Reason
          </span>
          {REASONS.map((option) => (
            <label key={option.value} {...stylex.props(styles.option, reason === option.value && styles.chosen)}>
              <input
                type="radio"
                name="reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                {...stylex.props(styles.radio)}
              />
              <span>
                {option.label}
                <small {...stylex.props(styles.hint)}>{option.hint}</small>
              </span>
            </label>
          ))}
        </div>

        <label htmlFor={noteId} {...stylex.props(styles.label)}>
          Anything to add?
        </label>
        <Textarea
          id={noteId}
          name="note"
          onSurface
          rows={2}
          maxLength={MAX_NOTE}
          placeholder="Optional, and one line is plenty"
        />

        {state.error && <HelpText error>{state.error}</HelpText>}

        <div {...stylex.props(styles.foot)}>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={reason === null}>
            Send report
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

const styles = stylex.create({
  stack: { display: "grid", gap: 12 },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: shape.field,
    backgroundColor: colors.ground,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.9375rem",
    color: colors.ink,
    cursor: "pointer",
  },
  chosen: { backgroundColor: colors.chip },
  radio: {
    appearance: "none",
    width: 22,
    height: 22,
    flexShrink: 0,
    marginBlock: 0,
    marginInline: 0,
    borderRadius: "50%",
    borderWidth: 3,
    borderStyle: "solid",
    borderColor: { default: colors.apricotLip, ":checked": colors.burnt },
    backgroundColor: "transparent",
    backgroundImage: {
      default: "none",
      ":checked": `radial-gradient(circle, ${colors.burnt} 0 40%, transparent 45%)`,
    },
    cursor: "pointer",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  hint: {
    display: "block",
    marginTop: 2,
    fontSize: "0.75rem",
    fontWeight: 700,
    color: colors.muted,
  },
  label: {
    display: "block",
    marginTop: 14,
    marginBottom: 6,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: colors.muted,
  },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
});
