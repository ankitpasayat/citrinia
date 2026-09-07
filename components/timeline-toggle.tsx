// All / Following. Two links in the segmented control, so the feed's state lives
// in the URL and survives a reload.
import { Segmented } from "./segmented";

export function TimelineToggle({ tab }: { tab?: string }) {
  const following = tab === "following";

  return (
    <Segmented
      label="Timeline"
      segments={[
        { href: "/", label: "All", current: !following },
        { href: "/?tab=following", label: "Following", current: following },
      ]}
    />
  );
}
