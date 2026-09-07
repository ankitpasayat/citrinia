"use client";

// The one question the app asks twice: from the dots menu on a profile, and from
// the Block button. Same words both times, because they are the same promise --
// and because the part people get wrong (the follows do not come back) is only
// worth writing once.
import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "@/app/tokens.stylex";
import { Button } from "./button";
import { Sheet } from "./sheet";

type Props = {
  handle: string;
  open: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function BlockConfirm({ handle, open, pending, onClose, onConfirm }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={`Block @${handle}?`}>
      <p {...stylex.props(styles.warning)}>
        They won&rsquo;t see your peels, reply to you or follow you, and you won&rsquo;t see
        theirs. You will both stop following each other, and{" "}
        <b {...stylex.props(styles.strong)}>unblocking later does not undo that</b>.
      </p>
      <div {...stylex.props(styles.foot)}>
        <Button variant="tertiary" onClick={onClose}>
          Never mind
        </Button>
        <Button variant="danger" loading={pending} onClick={onConfirm}>
          Block @{handle}
        </Button>
      </div>
    </Sheet>
  );
}

const styles = stylex.create({
  warning: { margin: 0, fontSize: "0.9375rem", lineHeight: 1.5, color: colors.muted },
  strong: { fontFamily: fonts.body, fontWeight: 800, color: colors.ink },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
});
