// The one layout unit: the viewport on phones, 520px centered from 600px up.
// Bottom padding leaves room for the tab bar plus the home-indicator safe area.
import * as stylex from "@stylexjs/stylex";
import { bp, shape } from "@/app/tokens.stylex";

export function Column({ children, withTabs = true }: { children: React.ReactNode; withTabs?: boolean }) {
  return <main {...stylex.props(styles.column, withTabs && styles.withTabs)}>{children}</main>;
}

const styles = stylex.create({
  column: {
    width: "100%",
    maxWidth: { default: "100%", [bp.tablet]: shape.column },
    marginInline: "auto",
    paddingTop: "calc(16px + env(safe-area-inset-top))",
    paddingInline: { default: 16, [bp.tablet]: 0 },
    paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  withTabs: {
    // No bar to clear on desktop, where the rail holds the navigation.
    paddingBottom: {
      default: "calc(124px + env(safe-area-inset-bottom))",
      [bp.desktop]: "calc(24px + env(safe-area-inset-bottom))",
    },
  },
});
