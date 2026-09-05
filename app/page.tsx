import { createClient } from "@/lib/supabase/server";
import AuthButtonServer from "./auth-button-server";
import { redirect } from "next/navigation";
import NewPeel from "./new-peel";
import Peels from "./peels";
import { ModeToggle } from "./mode-toggle";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("peels")
    .select("*, author: profiles(*), likes(user_id)")
    .order("created_at", { ascending: false });

  const peels =
    data?.map((peel) => ({
      ...peel,
      author: Array.isArray(peel.author) ? peel.author[0] : peel.author,
      user_has_liked_peel: !!peel.likes.find(
        (like) => like.user_id === user.id
      ),
      likes: peel.likes.length,
    })) ?? [];

  return (
    <div>
      <ModeToggle />
      <AuthButtonServer />
      <NewPeel user={user} />
      <Peels peels={peels} />
    </div>
  );
}
