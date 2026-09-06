import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// Temporary diagnostic: which Supabase project the server runtime is configured
// for. The url and the anon key are public (both ship in the browser bundle);
// only the key's project claim and length are echoed, never the key.
export const dynamic = "force-dynamic";

function claim(jwt: string | undefined, name: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from((jwt ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
    return String(payload[name] ?? null);
  } catch {
    return null;
  }
}

export function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return NextResponse.json({
    host: url ? new URL(url).host : null,
    anonRef: claim(anon, "ref"),
    anonRole: claim(anon, "role"),
    anonIssued: claim(anon, "iat"),
    anonLength: anon?.length ?? 0,
    anonSha256: anon ? createHash("sha256").update(anon).digest("hex").slice(0, 12) : null,
    runtime: process.env.NEXT_RUNTIME ?? "node",
  });
}
