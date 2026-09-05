// The empty block: a gradient blob, a Shrikhand line and a muted note. Used for
// empty feeds, empty profiles and empty search. Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, gradients } from "@/app/tokens.stylex";

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div {...stylex.props(styles.empty)}>
      <div {...stylex.props(styles.blob)} aria-hidden="true" />
      <h3 {...stylex.props(styles.title)}>{title}</h3>
      {body && <p {...stylex.props(styles.body)}>{body}</p>}
      {children}
    </div>
  );
}

const styles = stylex.create({
  empty: {
    display: "grid",
    gap: 8,
    justifyItems: "center",
    textAlign: "center",
    paddingBlock: 48,
    paddingInline: 20,
  },
  blob: {
    width: 96,
    height: 96,
    marginBottom: 8,
    borderRadius: "50%",
    backgroundImage: gradients.button,
    boxShadow: `inset 0 6px 0 rgba(255,255,255,0.4), 0 6px 0 ${colors.lip}`,
  },
  title: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.875rem",
    lineHeight: 1.1,
    color: colors.burnt,
  },
  body: { margin: 0, color: colors.muted },
});
