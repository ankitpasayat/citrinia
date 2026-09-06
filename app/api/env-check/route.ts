import { NextResponse } from "next/server";

// Temporary diagnostic: which Supabase host the server runtime is configured
// with. The url is public (it ships in the browser bundle); no keys are echoed.
export const dynamic = "force-dynamic";

export function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return NextResponse.json({ host: url ? new URL(url).host : null, runtime: process.env.NEXT_RUNTIME ?? "node" });
}
