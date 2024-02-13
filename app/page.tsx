import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import AuthButtonServer from "./auth-button-server";
import { redirect } from "next/navigation";
import NewPeel from "./new-peel";

export default async function Home() {
  const supabase = createServerComponentClient<Database>({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const { data: peels } = await supabase.from("peels").select("*, profiles(*)");

  return (
    <>
      <AuthButtonServer />
      <NewPeel />
      {peels?.map((peel) => {
        return (
          <div key={peel.id}>
            <p>
              {peel.profiles?.name} {peel.profiles?.username}
            </p>
            <p>{peel.title}</p>
          </div>
        );
      })}
    </>
  );
}
