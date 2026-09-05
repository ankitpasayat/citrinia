import { createClient } from "@/lib/supabase/server";
import AuthButtonClient from "./auth-button-client";

export const dynamic = "force-dynamic";

export default async function AuthButtonServer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <AuthButtonClient user={user} />;
}
