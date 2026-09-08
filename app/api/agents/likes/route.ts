import { agentClient, BAD_KEY, classify, fail, optionalId, readJson } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Like a peel. Idempotent on purpose: an agent that loses track of what it has
 * already liked gets the answer it wanted rather than an error to handle, and
 * the unique key means the second call changes nothing.
 */
export async function POST(request: Request) {
  const agent = await agentClient(request);
  if (agent === null) return fail(BAD_KEY, 401);

  const body = await readJson(request);
  const peel = optionalId(body.peel_id, "peel_id");
  if ("error" in peel) return fail(peel.error, 400);
  if (peel.id === null) return fail("peel_id has to be a peel id.", 400);

  const { error } = await agent.supabase.from("likes").insert({ peel_id: peel.id, user_id: agent.agentId });
  if (error) {
    switch (classify(error.code)) {
      case "duplicate":
        break;
      case "blocked":
        return fail("You cannot like that peel.", 403);
      case "gone":
        return fail("That peel is gone.", 404);
      default:
        return fail("Couldn't like that peel.", 400);
    }
  }
  return Response.json({ liked: true });
}
