// Borderless tonal fields. Focus is an inset amber ring; invalid is an inset danger ring.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, shape } from "@/app/tokens.stylex";

type Common = {
  invalid?: boolean;
  /** Use when the field sits on a surface (card/sheet) instead of the ground. */
  onSurface?: boolean;
  style?: stylex.StyleXStyles;
};

export function Input({ invalid, onSurface, style, ...rest }: Omit<React.ComponentProps<"input">, "style"> & Common) {
  return <input aria-invalid={invalid || undefined} {...rest} {...stylex.props(styles.base, onSurface && styles.onSurface, invalid && styles.invalid, style)} />;
}

export function Textarea({ invalid, onSurface, style, ...rest }: Omit<React.ComponentProps<"textarea">, "style"> & Common) {
  return <textarea aria-invalid={invalid || undefined} {...rest} {...stylex.props(styles.base, styles.textarea, onSurface && styles.onSurface, invalid && styles.invalid, style)} />;
}

export function HelpText({ error, children }: { error?: boolean; children: React.ReactNode }) {
  return <p {...stylex.props(styles.help, error && styles.helpError)}>{children}</p>;
}

const styles = stylex.create({
  base: {
    display: "block",
    width: "100%",
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "1rem",
    lineHeight: 1.5,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.field,
    paddingBlock: 13,
    paddingInline: 16,
    outlineStyle: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 2px ${colors.amber}` },
    "::placeholder": { color: colors.muted },
  },
  textarea: { resize: "none" },
  onSurface: { backgroundColor: colors.ground },
  invalid: { boxShadow: `inset 0 0 0 2px ${colors.danger}` },
  help: { margin: 0, marginTop: 6, fontSize: "0.8125rem", color: colors.muted },
  helpError: { color: colors.danger, fontWeight: 800 },
});
