"use client";

// Attaching pictures to a peel. The file never touches our server: it goes
// straight from the browser to the `media` Storage bucket, into a folder named
// after the uploader's uid (which is what the bucket's insert policy allows),
// and only the resulting public url is posted with the peel.
//
// The limits here are the composer's, not the table's: lib/media.ts still gates
// what reaches peel_media. These exist so somebody finds out before the upload
// rather than after it.
/* eslint-disable @next/next/no-img-element -- local object URLs; nothing for the optimizer to fetch */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./button";
import { HelpText, Input } from "./field";
import { ImageIcon } from "./icons";

/** One picked file plus the description that will become its alt text. */
export type Attachment = { file: File; alt: string };

export const MAX_FILES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Exactly the bucket's allowed_mime_types, so the upload cannot be the first to say no. */
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const ACCEPT = Object.keys(TYPES).join(",");

const isVideo = (file: File) => file.type.startsWith("video/");

export function MediaPicker({
  items,
  onChange,
  disabled = false,
}: {
  items: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // One object URL per file, revoked when the list changes or the sheet unmounts:
  // a preview that outlives its file is a leak the tab keeps until it is closed.
  const previews = useMemo(() => items.map((item) => URL.createObjectURL(item.file)), [items]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const full = items.length >= MAX_FILES || items.some((item) => isVideo(item.file));

  function pick(chosen: File[]) {
    const next = [...items, ...chosen.map((file) => ({ file, alt: stem(file.name) }))];
    const problem = check(next);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onChange(next);
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          pick([...(event.target.files ?? [])]);
          // Without this, picking the same file twice in a row fires no change event.
          event.target.value = "";
        }}
      />
      <Button
        variant="icon"
        aria-label="Add a picture or video"
        disabled={disabled || full}
        onClick={() => input.current?.click()}
      >
        <ImageIcon />
      </Button>

      {items.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {items.map((item, index) => (
            <li key={`${index}-${item.file.name}`} {...stylex.props(styles.item)}>
              <div {...stylex.props(styles.thumbBox)}>
                {previews[index] &&
                  (isVideo(item.file) ? (
                    <video src={previews[index]} muted preload="metadata" {...stylex.props(styles.thumb)} />
                  ) : (
                    <img src={previews[index]} alt="" {...stylex.props(styles.thumb)} />
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    onChange(items.filter((_, at) => at !== index));
                  }}
                  aria-label={`Remove ${item.file.name}`}
                  {...stylex.props(styles.remove)}
                >
                  {/* 44px of tap area around a 28px disc, so the thumbnail stays visible. */}
                  <span aria-hidden="true" {...stylex.props(styles.removeDisc)}>
                    ×
                  </span>
                </button>
              </div>
              {!isVideo(item.file) && (
                // peel_media rejects an image with no alt text, and a filename is
                // not a description, so this is editable rather than assumed.
                <Input
                  onSurface
                  value={item.alt}
                  maxLength={200}
                  placeholder="Describe it"
                  aria-label={`Alt text for ${item.file.name}`}
                  onChange={(event) =>
                    onChange(items.map((a, at) => (at === index ? { ...a, alt: event.target.value } : a)))
                  }
                  style={styles.alt}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <HelpText error>{error}</HelpText>}
    </div>
  );
}

/** The composer's own rules, checked against the whole list rather than each file. */
function check(next: Attachment[]): string | null {
  const unknown = next.find((item) => !(item.file.type in TYPES));
  if (unknown) return `${unknown.file.name} isn't a kind of media we peel.`;
  if (next.some((item) => isVideo(item.file))) {
    if (next.length > 1) return "A video peels on its own.";
  } else if (next.length > MAX_FILES) {
    return `Four pictures at most.`;
  }
  const big = next.find((item) => item.file.size > (isVideo(item.file) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES));
  if (big) {
    return isVideo(big.file)
      ? `${big.file.name} is over 25 MB.`
      : `${big.file.name} is over 5 MB.`;
  }
  return null;
}

/**
 * Upload every attachment and return the composer's `media` field. Nothing is
 * posted until all of them land: a peel missing half its pictures is not the
 * peel they wrote.
 */
export async function uploadAttachments(
  items: Attachment[],
): Promise<{ media: PeelMedia[] } | { error: string }> {
  if (items.length === 0) return { media: [] };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The bucket policy keys writes off auth.uid(), so there is nowhere to put this.
  if (!user) return { error: "You're signed out. Log in and try again." };

  // Checked before the first byte goes up: peel_media rejects an image with no
  // alt text, and failing after the uploads would leave orphans in the bucket.
  const undescribed = items.find((item) => !isVideo(item.file) && item.alt.trim() === "");
  if (undescribed) return { error: `${undescribed.file.name} needs a description.` };

  const media: PeelMedia[] = [];
  for (const { file, alt } of items) {
    const path = `${user.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
    const { error } = await supabase.storage
      .from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: `Couldn't upload ${file.name}. Try again.` };

    const {
      data: { publicUrl },
    } = supabase.storage.from("media").getPublicUrl(path);
    const size = await dimensions(file);
    media.push({
      kind: file.type === "image/gif" ? "gif" : isVideo(file) ? "video" : "image",
      url: publicUrl,
      alt: alt.trim(),
      ...size,
    });
  }
  return { media };
}

/** A picture's real shape, so the card reserves the right box before it loads. */
async function dimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  if (isVideo(file)) return { width: null, height: null };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // A shape we could not read is not worth failing a post over; the card copes.
    return { width: null, height: null };
  }
}

/** "lemon-slice.png" -> "lemon-slice": a starting point for alt text, not the answer. */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

const styles = stylex.create({
  wrap: { display: "grid", gap: 8, justifyItems: "start" },
  list: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    margin: 0,
    paddingInline: 0,
    listStyleType: "none",
  },
  item: { display: "grid", gap: 4, width: 120 },
  thumbBox: {
    position: "relative",
    width: 120,
    height: 90,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.chip,
  },
  thumb: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  remove: {
    position: "absolute",
    top: 0,
    right: 0,
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.pill,
    cursor: "pointer",
    touchAction: "manipulation",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -4,
  },
  removeDisc: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "1.125rem",
    lineHeight: 1,
    color: colors.onButton,
    backgroundColor: colors.lip,
    borderRadius: shape.pill,
  },
  alt: { fontSize: "0.75rem", paddingBlock: 6, paddingInline: 8, borderRadius: 10 },
});
