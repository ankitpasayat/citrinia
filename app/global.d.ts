import { Database as DB } from "@/lib/database.types";

type PeelRow = DB["public"]["Tables"]["peels"]["Row"];
type ProfileRow = DB["public"]["Tables"]["profiles"]["Row"];

declare global {
  type Database = DB;
  type Profile = ProfileRow;

  /** One attachment on a peel, in display order. `url` is always https. */
  type PeelMedia = {
    kind: "image" | "gif" | "video" | "youtube";
    url: string;
    alt: string;
    width: number | null;
    height: number | null;
  };

  /** What every screen gets for a peel. Built in lib/peels.ts, nowhere else. */
  type PeelUnionAuthor = PeelRow & {
    author: Profile;
    likes: number;
    replies: number;
    user_has_liked_peel: boolean;
    reposts: number;
    user_has_reposted: boolean;
    user_has_bookmarked: boolean;
    media: PeelMedia[];
    /** The peel this one quotes, one level deep: a quote's own quote is null. */
    quote: PeelUnionAuthor | null;
    /** Set only on a timeline row that is somebody's repost of this peel. */
    reposted_by?: Profile | null;
  };

  type NotificationItem = {
    id: number;
    type: "like" | "reply" | "quote" | "mention" | "follow" | "repost";
    created_at: string;
    read_at: string | null;
    actor: Profile;
    /** null for a follow, or when the peel has since been composted. */
    peel: PeelUnionAuthor | null;
  };
}
