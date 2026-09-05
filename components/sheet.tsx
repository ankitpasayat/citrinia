"use client";

// A bottom sheet on a native <dialog>. showModal() gives us the top layer, the
// backdrop, focus trapping and Escape for free; we only sync `open` and report
// every close (Escape, backdrop tap, or a caller closing it) through onClose.
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef } from "react";
import { bp, colors, fonts, gradients, shape } from "@/app/tokens.stylex";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      // The backdrop is the dialog's own pseudo-element, so a backdrop click
      // reports the dialog as its target -- but so does a click on the dialog's
      // padding, and that one must not throw away what someone just typed.
      // The point tells them apart.
      onClick={(event) => {
        const el = dialog.current;
        if (!el || event.target !== el) return;
        const box = el.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (outside) onClose();
      }}
      {...stylex.props(styles.sheet)}
    >
      <div {...stylex.props(styles.handle)} aria-hidden="true" />
      <h2 id={titleId} {...stylex.props(styles.title)}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}

const slideUp = stylex.keyframes({
  from: { transform: "translateY(100%)" },
  to: { transform: "translateY(0)" },
});

const styles = stylex.create({
  sheet: {
    position: "fixed",
    top: "auto",
    right: 0,
    bottom: 0,
    left: 0,
    width: "min(100%, 520px)",
    maxWidth: "100%",
    maxHeight: "85dvh",
    marginBlock: 0,
    marginInline: "auto",
    paddingTop: 12,
    paddingInline: 18,
    paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
    backgroundColor: colors.surface,
    color: colors.ink,
    borderWidth: 0,
    borderStyle: "none",
    borderTopLeftRadius: shape.sheet,
    borderTopRightRadius: shape.sheet,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    boxShadow: colors.shadowLg,
    overflowY: "auto",
    overscrollBehavior: "contain",
    animationName: slideUp,
    animationDuration: { default: "200ms", [bp.reduce]: "0ms" },
    animationTimingFunction: "ease-out",
    "::backdrop": { backgroundColor: colors.dim },
  },
  handle: {
    width: 64,
    height: 8,
    marginTop: 0,
    marginBottom: 14,
    marginInline: "auto",
    borderRadius: 4,
    backgroundImage: gradients.handle,
  },
  title: {
    margin: 0,
    marginBottom: 10,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.5rem",
    lineHeight: 1.1,
    color: colors.burnt,
  },
});
