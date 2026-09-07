// What stands where the peels would be on a profile a block separates you from.
// Two blocks, two notices: one explains a choice the reader made, the other
// explains one made about them. Neither pretends the person has no peels --
// "No peels yet" would be a lie the database is already telling by omission.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, shape } from "@/app/tokens.stylex";

type Props =
  | { kind: "you-blocked"; handle: string }
  | { kind: "they-blocked"; handle: string };

export function BlockNotice({ kind, handle }: Props) {
  const you = kind === "you-blocked";
  return (
    <section {...stylex.props(styles.card)}>
      <p {...stylex.props(styles.text)}>
        <b {...stylex.props(styles.title)}>
          {you ? `You blocked @${handle}` : `@${handle} has blocked you`}
        </b>
        {you
          ? "They can't see your peels or reply to you, and you won't see theirs. Unblock to see their peels."
          : "You can't follow, reply to or see their peels."}
      </p>
    </section>
  );
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.chip,
    borderRadius: shape.card,
    paddingBlock: 16,
    paddingInline: 20,
  },
  text: { margin: 0, fontSize: "0.9375rem", lineHeight: 1.5, color: colors.muted },
  title: {
    display: "block",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "1rem",
    color: colors.ink,
    marginBottom: 2,
  },
});
