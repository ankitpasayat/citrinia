// Suggestions: people the viewer does not follow yet, most-followed first. A
// server component with its own client, so any screen can drop it in without
// threading a Supabase client or a query through its props. Renders nothing when
// there is nobody left to suggest, so a caller never has to check first.
import { fetchSuggestedProfiles } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";
import { PersonList } from "./person-list";

export async function WhoToFollow({ viewerId, n = 5 }: { viewerId: string; n?: number }) {
  const supabase = await createClient();
  const people = await fetchSuggestedProfiles(supabase, viewerId, n);
  if (people.length === 0) return null;

  return (
    <PersonList
      heading="Who to follow"
      // A suggestion is someone the viewer does not follow and is not, by the
      // query that found them; the button owns that state after a tap.
      people={people.map((profile) => ({ profile, isFollowing: false, isSelf: false }))}
    />
  );
}
