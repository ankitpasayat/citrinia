import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { colors, fonts } from "./tokens.stylex";

export default function NotFound() {
  return (
    <Column withTabs={false}>
      <div {...stylex.props(styles.empty)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the app icon, one static svg */}
        <img src="/icon.svg" alt="" width={96} height={96} {...stylex.props(styles.logo)} />
        <h1 {...stylex.props(styles.heading)}>That peel got composted.</h1>
        <Link href="/" {...stylex.props(buttonStyles.base, buttonStyles.variants.primary, buttonStyles.sizes.md)}>
          Back to the feed
        </Link>
      </div>
    </Column>
  );
}

const styles = stylex.create({
  empty: {
    display: "grid",
    gap: 8,
    justifyItems: "center",
    textAlign: "center",
    marginTop: "auto",
    marginBottom: "auto",
    paddingBlock: 48,
    paddingInline: 20,
  },
  logo: { width: 96, height: 96, marginBottom: 8 },
  heading: { margin: 0, fontFamily: fonts.display, fontWeight: 400, fontSize: "1.875rem", lineHeight: 1.05, color: colors.burnt },
});
