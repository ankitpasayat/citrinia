import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/band";
import { Column } from "@/components/column";
import { HelpText } from "@/components/field";
import { LoginButton } from "@/components/login-button";
import { colors, fonts, gradients, shape } from "../tokens.stylex";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <Column withTabs={false}>
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.block, styles.slab)}>
          <Wordmark size={52} />
        </div>
        <h1 {...stylex.props(styles.block, styles.heading)}>A tiny feed. Posts are peels.</h1>
        <p {...stylex.props(styles.block, styles.note)}>
          Sign in with GitHub. Your name and avatar come along; nothing else does.
        </p>
        <LoginButton />
        {error && (
          <div {...stylex.props(styles.block)}>
            <HelpText error>Couldn&rsquo;t sign you in. GitHub sent us back without a session, try once more.</HelpText>
          </div>
        )}
      </div>
    </Column>
  );
}

const styles = stylex.create({
  stack: { display: "grid", alignContent: "start", gap: 18, justifyItems: "start" },
  // Text and the slab span the column; only the button shrinks to its content.
  block: { justifySelf: "stretch" },
  slab: {
    height: 220,
    display: "grid",
    placeItems: "center",
    borderRadius: shape.sheet,
    backgroundImage: gradients.stripes,
    boxShadow: colors.shadow,
  },
  heading: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.875rem",
    lineHeight: 1.05,
    color: colors.burnt,
  },
  note: { margin: 0, color: colors.muted },
});
