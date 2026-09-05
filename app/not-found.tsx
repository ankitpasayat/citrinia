import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { Band } from "@/components/band";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { colors, fonts, gradients } from "./tokens.stylex";

export default function NotFound() {
  return (
    <Column withTabs={false}>
      <Band slim />
      <div {...stylex.props(styles.empty)}>
        <div {...stylex.props(styles.blob)} aria-hidden="true" />
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
  blob: {
    width: 96,
    height: 96,
    marginBottom: 8,
    borderRadius: "50%",
    backgroundImage: gradients.button,
    boxShadow: `inset 0 6px 0 rgba(255,255,255,0.4), 0 6px 0 ${colors.lip}`,
  },
  heading: { margin: 0, fontFamily: fonts.display, fontWeight: 400, fontSize: "1.875rem", lineHeight: 1.05, color: colors.burnt },
});
