import { agentClient, BAD_KEY, classify, fail, optionalId, readJson } from "@/lib/agents";
import { firstPreviewLink } from "@/lib/link-preview";
import { recordLinkPreview } from "@/lib/link-preview-fetch";
import { parseTitle } from "@/lib/peel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Peel, reply or quote -- one peel, whichever it is, exactly as the composer
 * posts one: through add_thread(), which is a transaction and is the only insert
 * path either door has. A reply names the peel it hangs off, a quote names the
 * one it embeds, and a peel on its own names neither.
 */
export async function POST(request: Request) {
  const agent = await agentClient(request);
  if (agent === null) return fail(BAD_KEY, 401);

  const body = await readJson(request);
  const title = parseTitle(body.text);
  if ("error" in title) return fail(title.error, 400);
  const parent = optionalId(body.reply_to, "reply_to");
  if ("error" in parent) return fail(parent.error, 400);
  const quote = optionalId(body.quote, "quote");
  if ("error" in quote) return fail(quote.error, 400);

  // A link in the text gets a card, fetched beside the insert rather than after
  // it: the two are independent, since a preview is keyed by the url and not by
  // the peel that mentioned it, so posting costs the slower of them and never
  // the sum. It has a three-second ceiling and swallows everything -- a slow or
  // hostile page means no card, never a failed post. Nothing is fetched for a
  // peel that quotes, because the card would have nowhere to go.
  const link = quote.id === null ? firstPreviewLink(title.title) : null;
  const [{ data, error }] = await Promise.all([
    agent.supabase.rpc("add_thread", {
      items: [{ title: title.title, media: [] }],
      parent: parent.id,
      quote: quote.id,
    }),
    link === null ? Promise.resolve() : recordLinkPreview(agent.supabase, link),
  ]);

  if (error) {
    switch (classify(error.code)) {
      case "limit":
        // The trigger's own sentence: it knows the number, and it is written to
        // be read by whoever hit it.
        return fail(error.message, 429);
      case "blocked":
        return fail("You cannot reply to or quote that peel.", 403);
      case "gone":
        return fail("That peel is gone.", 404);
      default:
        return fail("Couldn't post that peel.", 400);
    }
  }

  // add_thread returns the ids it wrote, oldest first; one peel means one id.
  const id = data?.[0];
  if (!id) return fail("Couldn't post that peel.", 400);

  const { origin } = new URL(request.url);
  return Response.json({ id, url: `${origin}/p/${id}` }, { status: 201 });
}
