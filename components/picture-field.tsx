"use client";

// One picture on a profile: the avatar, or the banner behind it. Like the
// composer's attachments, the file goes straight from the browser to Storage —
// here to the `avatars` bucket, into a folder named after the uploader's uid,
// which is what that bucket's insert policy allows — and only the public url is
// saved on the profile.
//
// The limits below are the bucket's, restated so somebody finds out before the
// upload rather than after it. profiles_avatar_url_ok / profiles_banner_url_ok
// are the real gate on what can be stored.
/* eslint-disable @next/next/no-img-element -- a local object URL or a Storage url; nothing for the optimizer to fetch */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { objectPath } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { HelpText } from "./field";
import { ImageIcon, TrashIcon } from "./icons";

export const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;

/** Exactly the bucket's allowed_mime_types, so the upload cannot be the first to say no. */
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const ACCEPT = Object.keys(TYPES).join(",");

/**
 * What the sheet holds for one picture: a new file, `""` to take the saved one
 * down, or null for "leave it alone". Null is not the same as `""` — only one
 * of them writes to the column.
 */
export type PictureChoice = File | "" | null;

export function PictureField({
  label,
  kind,
  name,
  current,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  kind: "avatar" | "banner";
  /** The name beside an avatar, for its initials fallback. */
  name: string;
  /** What is saved right now. */
  current: string;
  value: PictureChoice;
  onChange: (next: PictureChoice) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const noun = label.toLowerCase();
  const [error, setError] = useState<string | null>(null);

  // One object URL, revoked when the choice changes or the sheet unmounts: a
  // preview that outlives its file is a leak the tab keeps until it is closed.
  const preview = useMemo(() => (value instanceof File ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // `""` means the saved picture is on its way out, so the preview shows none.
  const src = preview ?? (value === "" ? "" : current);

  function pick(file: File | undefined) {
    if (!file) return;
    if (!(file.type in TYPES)) {
      setError("Pick a JPEG, PNG, GIF or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is over 5 MB.`);
      return;
    }
    setError(null);
    onChange(file);
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <span id={labelId} {...stylex.props(styles.label)}>
        {label}
      </span>

      <div {...stylex.props(styles.row)}>
        {kind === "avatar" ? (
          <Avatar src={src} name={name} size="lg" />
        ) : (
          <span {...stylex.props(styles.banner)}>
            {src !== "" && <img src={src} alt="" {...stylex.props(styles.bannerImg)} />}
          </span>
        )}

        <span {...stylex.props(styles.buttons)}>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            hidden
            aria-labelledby={labelId}
            disabled={disabled}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              // Without this, picking the same file twice in a row fires no change event.
              event.target.value = "";
            }}
          />
          {/* Both fields sit in the same sheet, so each button says which
              picture it means rather than a bare "Remove" twice over. */}
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
            <ImageIcon />
            {src === "" ? "Add" : "Change"} {noun}
          </Button>
          {src !== "" && (
            <Button
              variant="tertiary"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setError(null);
                onChange("");
              }}
            >
              <TrashIcon />
              Remove {noun}
            </Button>
          )}
        </span>
      </div>

      {error && <HelpText error>{error}</HelpText>}
    </div>
  );
}

/**
 * Put one picture in the bucket and hand back its public url. A fresh name each
 * time, so the url changes and no CDN serves the old picture in its place.
 */
export async function uploadPicture(file: File, kind: "avatar" | "banner"): Promise<{ url: string } | { error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The bucket policy keys writes off auth.uid(), so there is nowhere to put this.
  if (!user) return { error: "You're signed out. Log in and try again." };

  const path = `${user.id}/${kind}-${crypto.randomUUID()}.${TYPES[file.type]}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: `Couldn't upload ${file.name}. Try again.` };

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: publicUrl };
}

/**
 * Best effort: drop a picture the profile no longer points at. Only ever the
 * uploader's own object in our own bucket — objectPath returns null for anything
 * else, and the bucket's delete policy would refuse it anyway. A failure here
 * leaves a file behind, which is not worth telling anybody about.
 */
export async function forgetPicture(url: string): Promise<void> {
  if (url === "") return;
  const path = objectPath(url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", BUCKET);
  if (path === null) return;
  await createClient().storage.from(BUCKET).remove([path]);
}

const styles = stylex.create({
  wrap: { display: "grid", gap: 6 },
  label: {
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: colors.muted,
  },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 },
  buttons: { display: "flex", alignItems: "center", gap: 8 },
  banner: {
    display: "block",
    width: 132,
    height: 44,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: shape.field,
    backgroundColor: colors.chip,
  },
  bannerImg: { width: "100%", height: "100%", objectFit: "cover" },
});
