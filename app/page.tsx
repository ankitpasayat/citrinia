import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import AuthButtonServer from "./auth-button-server";
import { redirect } from "next/navigation";
import NewPeel from "./new-peel";
import Peels from "./peels";
import { ModeToggle } from "./mode-toggle";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = createServerComponentClient<Database>({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
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
        (like) => like.user_id === session.user.id
      ),
      likes: peel.likes.length,
    })) ?? [];

  return (
    <div>
      <ModeToggle />
      <AuthButtonServer />
      <NewPeel user={session.user} />
      <Peels peels={peels} />
    </div>
  );
}
