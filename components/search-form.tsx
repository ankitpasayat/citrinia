"use client";

// A plain GET form: Enter navigates to /explore?q=…, so search works with no JS
// and every result page is a real, shareable URL.
import * as stylex from "@stylexjs/stylex";
import { colors } from "@/app/tokens.stylex";
import { Input } from "./field";
import { SearchIcon } from "./icons";

export function SearchForm({ q = "", autoFocus = true }: { q?: string; autoFocus?: boolean }) {
  return (
    <form role="search" action="/explore" method="get" {...stylex.props(styles.form)}>
      <span {...stylex.props(styles.icon)}>
        <SearchIcon />
      </span>
      <Input
        type="search"
        name="q"
        defaultValue={q}
        autoFocus={autoFocus}
        placeholder="Search peels and people"
        aria-label="Search peels and people"
        style={styles.input}
      />
    </form>
  );
}

const styles = stylex.create({
  form: { position: "relative", display: "block" },
  icon: {
    position: "absolute",
    insetInlineStart: 15,
    insetBlockStart: 0,
    insetBlockEnd: 0,
    display: "grid",
    placeItems: "center",
    color: colors.muted,
    pointerEvents: "none",
  },
  input: { paddingInlineStart: 44 },
});
