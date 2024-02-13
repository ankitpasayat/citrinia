"use client";

import { Button } from "@/components/ui/button";
import {
  Session,
  createClientComponentClient,
} from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";

export default function AuthButtonClient({
  session,
}: {
  session: Session | null;
}) {
  const supabase = createClientComponentClient<Database>();
  const router = useRouter();

  const getURL = () => {
    let url =
      process?.env?.NEXT_PUBLIC_SITE_URL ?? // Set this to your site URL in production env.
      process?.env?.NEXT_PUBLIC_VERCEL_URL ?? // Automatically set by Vercel.
      "http://localhost:3000/";
    // Make sure to include `https://` when not localhost.
    url = url.includes("http") ? url : `https://${url}`;
    // Make sure to include a trailing `/`.
    url = url.charAt(url.length - 1) === "/" ? url : `${url}/`;
    console.log(url);

    return url;
  };

  const handleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: getURL() + "auth/callback",
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.refresh();
  };

  return session ? (
    <>
      <Button onClick={handleSignOut}>Logout</Button>
    </>
  ) : (
    <Button onClick={handleSignIn}>Login</Button>
  );
}
