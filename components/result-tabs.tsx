// Top / Latest / People over a set of search results. Links, not buttons, so the
// tab lives in the URL and survives a reload or a share -- the segmented control
// the profile tabs and the timeline toggle use too. Server-safe.
import { Segmented } from "./segmented";

export type ResultTab = "top" | "latest" | "people";

const TABS: { tab: ResultTab; label: string }[] = [
  { tab: "top", label: "Top" },
  { tab: "latest", label: "Latest" },
  { tab: "people", label: "People" },
];

/** Anything that is not a tab name is the default tab, so a hand-edited URL still renders. */
export function parseResultTab(raw: string | undefined): ResultTab {
  return raw === "latest" || raw === "people" ? raw : "top";
}

export function ResultTabs({ q, tab }: { q: string; tab: ResultTab }) {
  const base = `/explore?q=${encodeURIComponent(q)}`;

  return (
    <Segmented
      label="Results"
      segments={TABS.map((item) => ({
        // Top is the default, so it is the bare address: the link a reader
        // shares out of a search is the shortest one that means what they saw.
        href: item.tab === "top" ? base : `${base}&tab=${item.tab}`,
        label: item.label,
        current: item.tab === tab,
      }))}
    />
  );
}
