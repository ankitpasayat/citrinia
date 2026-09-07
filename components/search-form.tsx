"use client";

// A plain GET form: Enter navigates to `action`?q=…, so search works with no JS
// and every result page is a real, shareable URL. Explore is what it searches
// unless somebody says otherwise -- /messages/new points it at itself.
import * as stylex from "@stylexjs/stylex";
import { colors } from "@/app/tokens.stylex";
import { Input } from "./field";
import { SearchIcon } from "./icons";

export function SearchForm({
  q = "",
  autoFocus = true,
  action = "/explore",
  label = "Search peels and people",
}: {
  q?: string;
  autoFocus?: boolean;
  action?: string;
  label?: string;
}) {
  return (
    <form role="search" action={action} method="get" {...stylex.props(styles.form)}>
      <span {...stylex.props(styles.icon)}>
        <SearchIcon />
      </span>
      <Input
        type="search"
        name="q"
        defaultValue={q}
        autoFocus={autoFocus}
        placeholder={label}
        aria-label={label}
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
