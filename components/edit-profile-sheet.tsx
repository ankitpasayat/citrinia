"use client";

// "Edit profile" and the sheet it opens: the pictures, the words, and the two
// facts underneath them. username stays GitHub-owned (the column grant is what
// enforces that, not this form).
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { updateProfile, type ActionResult } from "@/app/actions";
import { colors, fonts } from "@/app/tokens.stylex";
import { countChars } from "@/lib/peel";
import { MAX_BIO, MAX_HANDLE, MAX_LOCATION, MAX_NAME, MAX_WEBSITE } from "@/lib/profile";
import { Button } from "./button";
import { HelpText, Input, Textarea } from "./field";
import { Pill } from "./pill";
import { PictureField, forgetPicture, uploadPicture, type PictureChoice } from "./picture-field";
import { Sheet } from "./sheet";

export function EditProfileButton({ profile }: { profile: Profile }) {
  const router = useRouter();
  const nameId = useId();
  const bioId = useId();
  const locationId = useId();
  const websiteId = useId();
  const handleId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location);
  const [website, setWebsite] = useState(profile.website);
  const [handle, setHandle] = useState(profile.username);
  const [avatar, setAvatar] = useState<PictureChoice>(null);
  const [banner, setBanner] = useState<PictureChoice>(null);

  const [state, formAction, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    // The pictures go up before the row is written, and only a picture the
    // sheet actually touched is sent at all: an absent field leaves the column
    // as it was, where an empty one takes the picture down.
    for (const [choice, field, kind] of [
      [avatar, "avatar_url", "avatar"],
      [banner, "banner_url", "banner"],
    ] as const) {
      if (choice instanceof File) {
        const up = await uploadPicture(choice, kind);
        if ("error" in up) return { error: up.error };
        formData.set(field, up.url);
      } else if (choice === "") {
        formData.set(field, "");
      }
    }

    const result = await updateProfile(prev, formData);
    if (!result.error) {
      // A handle change moves the profile: the url in the address bar is an old
      // handle now, and it would only redirect back here on the next load.
      if (result.username) router.replace(`/u/${encodeURIComponent(result.username)}`);
      // Only once the row that pointed at them is saved, and only ever our own
      // objects — a GitHub avatar is not ours to delete, and forgetPicture knows.
      if (avatar !== null) void forgetPicture(profile.avatar_url);
      if (banner !== null) void forgetPicture(profile.banner_url);
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
    setLocation(profile.location);
    setWebsite(profile.website);
    setHandle(profile.username);
    setAvatar(null);
    setBanner(null);
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
          <div {...stylex.props(styles.pictures)}>
            <PictureField
              label="Photo"
              kind="avatar"
              name={name}
              current={profile.avatar_url}
              value={avatar}
              onChange={setAvatar}
              disabled={pending}
            />
            <PictureField
              label="Banner"
              kind="banner"
              name={name}
              current={profile.banner_url}
              value={banner}
              onChange={setBanner}
              disabled={pending}
            />
          </div>

          <label htmlFor={nameId} {...stylex.props(styles.label, styles.labelGap)}>
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

          <label htmlFor={handleId} {...stylex.props(styles.label, styles.labelGap)}>
            Handle
          </label>
          <Input
            id={handleId}
            name="username"
            onSurface
            maxLength={MAX_HANDLE}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
          />
          <HelpText>
            {handle.toLowerCase() === profile.username
              ? "People find you at @" + profile.username + "."
              : `@${profile.username} will keep pointing here.`}
          </HelpText>

          <label htmlFor={locationId} {...stylex.props(styles.label, styles.labelGap)}>
            Location
          </label>
          <Input
            id={locationId}
            name="location"
            onSurface
            maxLength={MAX_LOCATION}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            autoComplete="address-level2"
          />

          <label htmlFor={websiteId} {...stylex.props(styles.label, styles.labelGap)}>
            Website
          </label>
          <Input
            id={websiteId}
            name="website"
            // Not type="url": that would refuse "citrinia.example" in the
            // browser before parseWebsite ever got the chance to add the scheme.
            inputMode="url"
            onSurface
            maxLength={MAX_WEBSITE}
            placeholder="citrinia.example"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            autoComplete="url"
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
  pictures: { display: "grid", gap: 14 },
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
