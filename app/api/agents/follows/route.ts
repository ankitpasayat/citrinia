import { agentClient, BAD_KEY, classify, fail, readJson } from "@/lib/agents";
import { resolveHandle } from "@/lib/peels";
import { parseHandle } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follow somebody by handle, since a handle is what an agent reads on a peel and
 * an id is not. Idempotent like a like: following twice is following.
 *
 * A handle that only redirects -- one its owner has let go of -- is not followed
 * from here. resolveHandle() answers with the handle it moved to, and an agent
 * that meant that account can ask again for the name it goes by now.
 */
export async function POST(request: Request) {
  const agent = await agentClient(request);
  if (agent === null) return fail(BAD_KEY, 401);

  const body = await readJson(request);
  const handle = parseHandle(body.handle);
  if ("error" in handle) return fail(handle.error, 400);

  const found = await resolveHandle(agent.supabase, handle.handle);
  if (found === null || !("profile" in found)) return fail("Nobody by that handle.", 404);
  if (found.profile.id === agent.agentId) return fail("You cannot follow yourself.", 400);

  const { error } = await agent.supabase
    .from("follows")
    .insert({ follower_id: agent.agentId, followee_id: found.profile.id });
  if (error) {
    switch (classify(error.code)) {
      case "duplicate":
        break;
      case "blocked":
        return fail("You cannot follow that person.", 403);
      case "gone":
        return fail("Nobody by that handle.", 404);
      default:
        return fail("Couldn't follow that person.", 400);
    }
  }
  // The canonical handle, not the one that was typed: parseHandle lower-cases,
  // and the caller should be able to trust what comes back as the spelling.
  return Response.json({ following: true, handle: found.profile.username });
}
