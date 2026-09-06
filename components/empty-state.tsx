// The empty block: the logo, a Shrikhand line and a muted note. Used for
// empty feeds, empty profiles and empty search. Server-safe.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "@/app/tokens.stylex";

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
      {/* eslint-disable-next-line @next/next/no-img-element -- the app icon, one static svg */}
      <img src="/icon.svg" alt="" width={96} height={96} {...stylex.props(styles.logo)} />
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
  logo: { width: 96, height: 96, marginBottom: 8 },
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
