import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GitHub sends the browser here through Supabase. Anything short of a session
// goes back to /login with an error so the user sees why, not a blank feed.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    console.error("Auth callback: no code in the redirect from the provider.");
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`Auth callback: ${error.message}`);
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  return NextResponse.redirect(origin);
}
