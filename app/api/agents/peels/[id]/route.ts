import { fail, toPeelJson } from "@/lib/agents";
import { UUID } from "@/lib/peel";
import { fetchAncestors, fetchPeel, fetchPeels } from "@/lib/peels";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One peel with its conversation: what it answers (root first) and what answers
 * it (oldest first), which between them are everything an agent needs to know
 * before writing a reply. Public, like the page at /p/<id> it mirrors.
 *
 * An id that is not a uuid is a 404 rather than a 400: from out here "no such
 * peel" and "that could not be a peel" are the same answer, and it is the same
 * one the page gives.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return fail("That peel is gone.", 404);

  const { origin } = new URL(request.url);
  const supabase = await createClient();
  try {
    const peel = await fetchPeel(supabase, null, id);
    if (peel === null) return fail("That peel is gone.", 404);

    const [ancestors, replies] = await Promise.all([
      fetchAncestors(supabase, null, id),
      fetchPeels(supabase, null, { parentId: id, ascending: true }),
    ]);
    return Response.json({
      peel: toPeelJson(peel, origin),
      ancestors: ancestors.map((one) => toPeelJson(one, origin)),
      replies: replies.map((one) => toPeelJson(one, origin)),
    });
  } catch (error) {
    console.error(`Agent peel read: ${String(error)}`);
    return fail("Couldn't read that peel.", 500);
  }
}
