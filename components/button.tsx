// Creamsicle buttons: a pill with a 4px lip. Hover brightens, press sinks 4px onto
// the lip. Server-safe (no hooks); pass onClick from client components.
import * as stylex from "@stylexjs/stylex";
import { bp, colors, fonts, gradients, shape } from "@/app/tokens.stylex";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "fab" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

type Props = Omit<React.ComponentProps<"button">, "style"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  style?: stylex.StyleXStyles;
};

export function Button({ variant = "primary", size = "md", loading = false, style, children, disabled, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
      {...stylex.props(styles.base, variants[variant], sizes[size], style)}
    >
      {loading && <span aria-hidden="true" {...stylex.props(styles.spinner)} />}
      {children}
    </button>
  );
}

/** For <Link> or <a> that should look like a button: {...stylex.props(buttonStyles.base, buttonStyles.variants.primary, buttonStyles.sizes.md)} */
export const buttonStyles = {
  get base() {
    return styles.base;
  },
  get variants() {
    return variants;
  },
  get sizes() {
    return sizes;
  },
};

const LIP_UP = `inset 0 2px 0 rgba(255,255,255,0.45), 0 4px 0 ${colors.lip}`;
const LIP_DOWN = `inset 0 2px 0 rgba(255,255,255,0.45), 0 0 0 ${colors.lip}`;

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: 1,
    letterSpacing: "0.02em",
    color: colors.onButton,
    textShadow: `1px 1px 0 ${colors.onStripe}`,
    textDecorationLine: "none",
    whiteSpace: "nowrap",
    backgroundColor: "transparent",
    backgroundImage: gradients.button,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: shape.pill,
    paddingBlock: 12,
    paddingInline: 22,
    minHeight: 44,
    boxShadow: { default: LIP_UP, ":active": LIP_DOWN, ":disabled": LIP_UP },
    transform: { default: "none", ":active": "translateY(4px)", ":disabled": "none" },
    filter: {
      default: "none",
      [bp.hover]: { default: "none", ":hover": "brightness(1.07)" },
      ":disabled": "saturate(0.4) brightness(1.05)",
    },
    opacity: { default: 1, ":disabled": 0.6 },
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    userSelect: "none",
    touchAction: "manipulation",
    transitionProperty: "transform, box-shadow, filter",
    transitionDuration: { default: "90ms", [bp.reduce]: "0ms" },
    transitionTimingFunction: "ease",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: 3,
  },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    borderWidth: 3,
    borderStyle: "solid",
    borderColor: "rgba(255,248,236,0.35)",
    borderTopColor: colors.onButton,
    animationName: stylex.keyframes({ to: { transform: "rotate(360deg)" } }),
    animationDuration: { default: "700ms", [bp.reduce]: "0ms" },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const SEC_UP = `inset 0 2px 0 rgba(255,255,255,0.6), 0 4px 0 ${colors.apricotLip}`;
const SEC_DOWN = `inset 0 2px 0 rgba(255,255,255,0.6), 0 0 0 ${colors.apricotLip}`;

const variants = stylex.create({
  primary: {},
  secondary: {
    backgroundImage: gradients.secondary,
    color: colors.ink,
    textShadow: "none",
    boxShadow: { default: SEC_UP, ":active": SEC_DOWN, ":disabled": SEC_UP },
  },
  tertiary: {
    backgroundImage: "none",
    color: { default: colors.ink, ":hover": colors.burnt },
    textShadow: "none",
    boxShadow: "none",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.9375rem",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationColor: colors.burnt,
    textUnderlineOffset: 5,
    transform: "none",
    filter: "none",
  },
  danger: {
    backgroundImage: gradients.danger,
  },
  fab: {
    width: 60,
    height: 60,
    minHeight: 60,
    paddingBlock: 0,
    paddingInline: 0,
    borderRadius: "50%",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "1.875rem",
    textShadow: "none",
  },
  icon: {
    width: 44,
    height: 44,
    minHeight: 44,
    paddingBlock: 0,
    paddingInline: 0,
    borderRadius: "50%",
    backgroundImage: "none",
    backgroundColor: { default: "transparent", ":hover": colors.chip },
    color: { default: colors.muted, ":hover": colors.ink },
    textShadow: "none",
    boxShadow: "none",
    transform: "none",
    filter: "none",
    fontSize: "1.125rem",
  },
});

const sizes = stylex.create({
  sm: { fontSize: "0.875rem", paddingBlock: 9, paddingInline: 16, minHeight: 44 },
  md: {},
  lg: { fontSize: "1.1875rem", paddingBlock: 15, paddingInline: 28, minHeight: 54 },
});
