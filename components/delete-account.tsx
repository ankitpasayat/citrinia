"use client";

// The bottom of /settings, and the only thing on this app that cannot be undone.
//
// The row opens a dialog that asks for the handle in writing. Typing it is the
// whole confirmation -- there is no second "are you sure" -- and the check that
// matters is not this form's: delete_account() compares what was typed against
// the session's own profile, in the database, where a crafted call meets it too.
import * as stylex from "@stylexjs/stylex";
import { useActionState, useId, useState } from "react";
import { deleteAccount, type ActionResult } from "@/app/actions";
import { colors, fonts } from "@/app/tokens.stylex";
import { MAX_HANDLE, parseHandle } from "@/lib/profile";
import { Button } from "./button";
import { HelpText, Input } from "./field";
import { Sheet } from "./sheet";

export function DeleteAccount({ username }: { username: string }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const [state, formAction, pending] = useActionState(
    // On success this never returns: the action ends the session and redirects.
    async (prev: ActionResult, formData: FormData) => deleteAccount(prev, formData),
    {} as ActionResult,
  );

  // The same normalising the action and the database both apply, so the button
  // is live exactly when the handle would be accepted -- "@Ada " included.
  const parsed = parseHandle(typed);
  const matches = "handle" in parsed && parsed.handle === username;

  return (
    <>
      <button type="button" onClick={() => { setTyped(""); setOpen(true); }} {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.label)}>Delete account</span>
        <span aria-hidden="true" {...stylex.props(styles.chevron)}>
          ›
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Delete your account?">
        <form action={formAction}>
          <p {...stylex.props(styles.warning)}>
            Your peels, likes, follows and bookmarks go with it, now, for everyone. Type{" "}
            <b {...stylex.props(styles.handle)}>@{username}</b> to confirm.
          </p>

          <label htmlFor={fieldId} {...stylex.props(styles.fieldLabel)}>
            Your handle
          </label>
          <Input
            id={fieldId}
            name="confirm"
            onSurface
            maxLength={MAX_HANDLE + 1}
            placeholder={`@${username}`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
          />

          {state.error && <HelpText error>{state.error}</HelpText>}

          <div {...stylex.props(styles.foot)}>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" loading={pending} disabled={!matches}>
              Delete everything
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    minHeight: 44,
    paddingBlock: 12,
    paddingInline: 10,
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 14,
    textAlign: "left",
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  label: { fontFamily: fonts.body, fontWeight: 800, fontSize: "0.9375rem", color: colors.danger },
  chevron: { fontWeight: 800, color: colors.danger },
  warning: {
    margin: 0,
    marginBottom: 14,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    lineHeight: 1.5,
    color: colors.muted,
  },
  handle: { color: colors.ink, fontWeight: 800 },
  fieldLabel: {
    display: "block",
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
