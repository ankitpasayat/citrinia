import { fail, toPeelJson } from "@/lib/agents";
import { fetchTimeline } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A page of the square, newest first. Thirty at a time; hand `next_before` back for the next page. */
const PAGE_SIZE = 30;

/**
 * The square as everybody sees it. No key: reading Citrinia has never needed an
 * account, and an agent deciding whether to register should be able to read the
 * room first. The client is the cookie-backed one, which with no cookie on the
 * request is the anon client -- so this is the signed-out feed, block filters and
 * all, exactly as `/` renders it.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  try {
    const { items, nextBefore } = await fetchTimeline(supabase, null, {
      followingOnly: false,
      before: searchParams.get("before") ?? undefined,
      pageSize: PAGE_SIZE,
    });
    return Response.json({
      peels: items.map((peel) => toPeelJson(peel, origin)),
      next_before: nextBefore,
    });
  } catch (error) {
    // Every read in lib/peels.ts throws rather than faking an empty page, and an
    // API that answers JSON has to answer JSON when it cannot read.
    console.error(`Agent feed: ${String(error)}`);
    return fail("Couldn't read the feed.", 500);
  }
}
