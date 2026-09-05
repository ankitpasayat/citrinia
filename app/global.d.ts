import { Database as DB } from "@/lib/database.types";

type PeelRow = DB["public"]["Tables"]["peels"]["Row"];
type ProfileRow = DB["public"]["Tables"]["profiles"]["Row"];

declare global {
  type Database = DB;
  type Profile = ProfileRow;
  type PeelUnionAuthor = PeelRow & {
    author: Profile;
    likes: number;
    replies: number;
    user_has_liked_peel: boolean;
  };
}
