import { updateSession } from "@/lib/supabase/middleware";

import type { NextRequest } from "next/server";

// Next 16 renamed middleware to proxy. Refreshes the Supabase session cookie on
// every request so server components never see an expired session.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - fonts, icon and manifest
     * - the service worker (serwist/) and the offline page it precaches, neither of which has a session
     * - image files (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|fonts/|icon.svg|manifest.webmanifest|serwist/|offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
