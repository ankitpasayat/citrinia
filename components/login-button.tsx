"use client";

// The one button on /login. OAuth starts in the browser so Supabase can hand
// GitHub a redirect back to this origin's callback route.
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./button";
import { HelpText } from "./field";
import { GitHubIcon } from "./icons";

export function LoginButton() {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setLoading(true);
    setFailed(false);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    // On success the browser is already navigating to GitHub; only errors return.
    if (error) {
      console.error(error.message);
      setLoading(false);
      setFailed(true);
    }
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <Button size="lg" loading={loading} onClick={start}>
        {!loading && <GitHubIcon />}
        Continue with GitHub
      </Button>
      {failed && <HelpText error>Couldn&rsquo;t reach GitHub. Try once more.</HelpText>}
    </div>
  );
}

const styles = stylex.create({
  wrap: { display: "grid", gap: 2, justifyItems: "start" },
});
