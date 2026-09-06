// Cursor pagination link used under every list: feed, profile tabs, bookmarks.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { buttonStyles } from "./button";

export function ShowOlder({ href, label = "Show older peels" }: { href: string; label?: string }) {
  return (
    <div {...stylex.props(styles.row)}>
      <Link href={href} {...stylex.props(buttonStyles.base, buttonStyles.variants.secondary, buttonStyles.sizes.sm)}>
        {label}
      </Link>
    </div>
  );
}

const styles = stylex.create({
  row: { display: "flex", justifyContent: "center", paddingBlock: 8 },
});
