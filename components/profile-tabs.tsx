// Peels / Replies / Media / Likes on a profile. Links, not buttons, so the tab lives in
// the URL and survives a reload or a share -- the segmented control the timeline
// toggle and the follows pages use too. Server-safe.
import { Segmented } from "./segmented";

export type ProfileTab = "peels" | "replies" | "media" | "likes";

const TABS: { tab: ProfileTab; label: string }[] = [
  { tab: "peels", label: "Peels" },
  { tab: "replies", label: "Replies" },
  { tab: "media", label: "Media" },
  { tab: "likes", label: "Likes" },
];

/** Anything that is not a tab name is the default tab, so a hand-edited URL still renders. */
export function parseProfileTab(raw: string | undefined): ProfileTab {
  return raw === "replies" || raw === "media" || raw === "likes" ? raw : "peels";
}

export function ProfileTabs({ username, tab }: { username: string; tab: ProfileTab }) {
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <Segmented
      label="Profile timeline"
      segments={TABS.map((item) => ({
        href: item.tab === "peels" ? base : `${base}?tab=${item.tab}`,
        label: item.label,
        current: item.tab === tab,
      }))}
    />
  );
}
