// Above a conversation somebody started who you do not follow. It says who is
// asking and gives the three answers; replying is the fourth, and accepts it
// just the same. Server-safe -- the buttons are the client leaf.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { RequestActions } from "./request-actions";

export function RequestBanner({
  conversationId,
  other,
}: {
  conversationId: string;
  other: Profile;
}) {
  return (
    <section {...stylex.props(styles.card)} aria-label="Message request">
      <p {...stylex.props(styles.text)}>
        <b {...stylex.props(styles.who)}>{other.name}</b> wants to message you. They will not know
        you have read this until you answer.
      </p>
      <RequestActions
        conversationId={conversationId}
        profileId={other.id}
        handle={other.username}
      />
    </section>
  );
}

const styles = stylex.create({
  card: {
    display: "grid",
    gap: 12,
    backgroundColor: colors.chip,
    borderRadius: shape.card,
    paddingBlock: 14,
    paddingInline: 16,
  },
  text: {
    margin: 0,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.875rem",
    lineHeight: 1.4,
    color: colors.ink,
  },
  who: { fontFamily: fonts.display, fontWeight: 400, fontSize: "1rem", color: colors.burnt },
});
