import { Database as DB } from "@/lib/database.types";

type Peel = DB["public"]["Tables"]["peels"]["Row"];
type Profile = DB["public"]["Tables"]["profiles"]["Row"];

declare global {
  type Database = DB;
  type PeelUnionAuthor = Peel & {
    author: Profile;
    likes: number;
    user_has_liked_peel: boolean;
  };
}
