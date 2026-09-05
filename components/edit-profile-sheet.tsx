"use client";

// "Edit profile" and the sheet it opens. username and avatar_url stay
// GitHub-owned, so only name and bio are editable here.
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { updateProfile, type ActionResult } from "@/app/actions";
import { colors, fonts } from "@/app/tokens.stylex";
import { countChars } from "@/lib/peel";
import { MAX_BIO, MAX_NAME } from "@/lib/profile";
import { Button } from "./button";
import { HelpText, Input, Textarea } from "./field";
import { Pill } from "./pill";
import { Sheet } from "./sheet";

export function EditProfileButton({ profile }: { profile: Profile }) {
  const router = useRouter();
  const nameId = useId();
  const bioId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);

  const [state, formAction, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    const result = await updateProfile(prev, formData);
    if (!result.error) {
      setOpen(false);
      router.refresh();
    }
    return result;
  }, {} as ActionResult);

  // The sheet always opens on what the server has, so edits that were cancelled —
  // and edits that were saved, whose values only reach us on the next render —
  // are both thrown away without reading a stale prop on the way out.
  function reopen() {
    setName(profile.name);
    setBio(profile.bio);
    setOpen(true);
  }

  const left = MAX_BIO - countChars(bio);
  const blocked = name.trim() === "" || left < 0;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={reopen}>
        Edit profile
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Edit profile">
        <form action={formAction}>
          <label htmlFor={nameId} {...stylex.props(styles.label)}>
            Name
          </label>
          <Input
            id={nameId}
            name="name"
            onSurface
            maxLength={MAX_NAME}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />

          <label htmlFor={bioId} {...stylex.props(styles.label, styles.labelGap)}>
            Bio
          </label>
          <Textarea
            id={bioId}
            name="bio"
            onSurface
            rows={3}
            invalid={left < 0}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />

          {state.error && <HelpText error>{state.error}</HelpText>}

          <div {...stylex.props(styles.foot)}>
            <Pill tone={left < 0 ? "danger" : left < 20 ? "amber" : "mustard"}>
              {left < 0 ? `${-left} over` : `${left} left`}
            </Pill>
            <span {...stylex.props(styles.buttons)}>
              <Button variant="tertiary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={blocked}>
                Save
              </Button>
            </span>
          </div>
        </form>
      </Sheet>
    </>
  );
}

const styles = stylex.create({
  label: {
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
  labelGap: { marginTop: 14 },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  buttons: { display: "flex", alignItems: "center", gap: 10 },
});
