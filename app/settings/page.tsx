// Settings: the page every app needs and nobody designs.
//
// Sections are added by the slice that has something to put in one, rather than
// stubbed out ahead of it -- so Email and Password arrive with email sign-in.
// What is here is what works.
import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Column } from "@/components/column";
import { DeleteAccount } from "@/components/delete-account";
import { FeedShell } from "@/components/feed-shell";
import { ThemeSetting } from "@/components/theme-setting";
import { createClient } from "@/lib/supabase/server";
import { bp, colors, fonts, shape } from "../tokens.stylex";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  if (!profile) throw new Error("No profile for the signed-in user.");

  return (
    <FeedShell username={profile.username}>
      <Column>
        <h1 {...stylex.props(styles.heading)}>Settings</h1>

        <h2 {...stylex.props(styles.section)}>Account</h2>
        <div {...stylex.props(styles.group)}>
          {/* One handle, one form that changes it: the row goes to the profile,
              where Edit profile already owns that field. */}
          <Link href={`/u/${encodeURIComponent(profile.username)}`} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.rowLabel)}>Username</span>
            <span {...stylex.props(styles.rowValue)}>@{profile.username}</span>
            <span aria-hidden="true" {...stylex.props(styles.chevron)}>
              ›
            </span>
          </Link>
        </div>

        <h2 {...stylex.props(styles.section)}>People</h2>
        <div {...stylex.props(styles.group)}>
          {/* Blocked joins this group with the other half of the slice. */}
          <Link href="/settings/muted" {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.rowLabel)}>Muted</span>
            <span aria-hidden="true" {...stylex.props(styles.chevron)}>
              ›
            </span>
          </Link>
        </div>

        <h2 {...stylex.props(styles.section)}>Appearance</h2>
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.row, styles.staticRow)}>
            <span {...stylex.props(styles.rowLabel)}>Theme</span>
            <ThemeSetting />
          </div>
        </div>

        <h2 {...stylex.props(styles.section)}>Danger</h2>
        <div {...stylex.props(styles.group)}>
          <DeleteAccount username={profile.username} />
        </div>
      </Column>
    </FeedShell>
  );
}

const styles = stylex.create({
  heading: {
    margin: 0,
    fontFamily: fonts.display,
    fontWeight: 400,
    fontSize: "1.625rem",
    lineHeight: 1.15,
    color: colors.burnt,
  },
  section: {
    margin: 0,
    marginTop: 20,
    marginBottom: 8,
    marginInlineStart: 4,
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: colors.muted,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: shape.card,
    boxShadow: colors.shadow,
    paddingBlock: 6,
    paddingInline: 8,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 44,
    paddingBlock: 12,
    paddingInline: 10,
    borderRadius: 14,
    textDecorationLine: "none",
    color: colors.ink,
    backgroundColor: {
      default: "transparent",
      [bp.hover]: { default: "transparent", ":hover": colors.chip },
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 3,
    outlineColor: colors.amber,
    outlineOffset: -3,
  },
  // A row that holds a control rather than going somewhere does not light up.
  staticRow: { backgroundColor: "transparent", flexWrap: "wrap" },
  rowLabel: { fontFamily: fonts.body, fontWeight: 800, fontSize: "0.9375rem" },
  rowValue: {
    marginInlineStart: "auto",
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: colors.muted,
    overflowWrap: "anywhere",
  },
  chevron: { fontWeight: 800, color: colors.muted },
});
