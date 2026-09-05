import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuthButtonClient from "../auth-button-client";
import { ModeToggle } from "../mode-toggle";

export const dynamic = "force-dynamic";

export default async function Login() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <div>
      <ModeToggle />
      <AuthButtonClient user={user} />
    </div>
  );
}
