import type { Metadata } from "next";
import * as stylex from "@stylexjs/stylex";
import { Band } from "@/components/band";
import { buttonStyles } from "@/components/button";
import { Column } from "@/components/column";
import { colors, fonts, gradients } from "../tokens.stylex";

export const metadata: Metadata = { title: "Offline" };

// What the service worker shows for a page it has not cached when the network
// is gone. Static on purpose: it reads no cookies, so it can be precached, and
// the link is a plain anchor so trying again is a full request through the
// worker rather than a client-side fetch that would fail the same way.
export default function Offline() {
  return (
    <Column withTabs={false}>
      <Band slim />
      <div {...stylex.props(styles.empty)}>
        <div {...stylex.props(styles.blob)} aria-hidden="true" />
        <h1 {...stylex.props(styles.heading)}>You&apos;re offline.</h1>
        <p {...stylex.props(styles.copy)}>The peels are still there. Try again once you&apos;re back on.</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full request, see above */}
        <a href="/" {...stylex.props(buttonStyles.base, buttonStyles.variants.primary, buttonStyles.sizes.md)}>
          Try again
        </a>
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
  copy: { margin: 0, color: colors.muted },
});
