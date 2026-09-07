// The one outbound request this app makes, and the guard around it.
//
// Somebody posts a peel with a link in it; this goes and reads that page's Open
// Graph tags so the card underneath can say what is on the other end. The url
// comes from a stranger, so the fetch is the interesting part rather than the
// parsing:
//
//   * every address the resolver returns is checked before anything connects to
//     it, and the connection is made to an address that passed -- so a hostname
//     that resolves to 169.254.169.254 is refused however it is spelled, and
//     there is no window between the check and the connect for it to change;
//   * https only, so a plain-http hop cannot be rewritten in flight;
//   * redirects are followed by hand, three at most, each one checked again --
//     a public page that 302s to an internal one is the usual way past a guard
//     that only looks at the url somebody typed;
//   * three seconds for the whole thing, DNS to last byte, and half a megabyte
//     of html at most.
//
// Everything here fails by returning nothing. A slow site, a dead link, a page
// that is not html: no card, and the peel is posted exactly the same.
//
// Server-only: it imports node:http.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { StringDecoder } from "node:string_decoder";
import type { LookupFunction } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicAddress, parseOpenGraph, type LinkPreview } from "./link-preview.ts";

/** DNS to last byte. The ceiling is what keeps a slow site from slowing a post. */
const BUDGET_MS = 3000;
/** A head is a few kilobytes; half a megabyte is already a page that has lost the plot. */
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "CitriniaBot/1.0 (+https://citrinia.vercel.app)";

/**
 * The one origin the address guard steps aside for, named by an environment
 * variable that is set for the e2e run and nowhere else. The suite serves the
 * page it previews from 127.0.0.1, which is exactly what the guard exists to
 * refuse; with this unset -- production, always -- there is no exception at all.
 *
 * Read per call rather than at import, so a test can set it and mean it.
 */
function testOrigin(): string | null {
  const raw = process.env.LINK_PREVIEW_TEST_ORIGIN?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** A url this is willing to open at all: https, or the e2e server. */
function allowed(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.origin === testOrigin();
}

/**
 * `dns.lookup`, minus every address that is not out on the internet. The
 * connection is then made to one of the addresses this returned -- not to the
 * name again -- so what was checked is what is connected to.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }
    const reachable = (addresses as LookupAddress[]).filter((found) =>
      isPublicAddress(found.address, found.family),
    );
    if (reachable.length === 0) {
      const refused: NodeJS.ErrnoException = new Error(
        `${hostname} does not resolve to a public address`,
      );
      refused.code = "ENOTFOUND";
      callback(refused, "", 4);
      return;
    }
    // Any of them is a fine place to connect: they all passed. `all` decides the
    // shape of the answer, not which address is used.
    if (options.all) callback(null, reachable);
    else callback(null, reachable[0].address, reachable[0].family);
  });
};

type Answer = { redirectTo: string | null; html: string };

/** One request, bounded. Resolves null for anything that is not a page we can read. */
function get(url: URL, deadline: number): Promise<Answer | null> {
  return new Promise((resolve) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      resolve(null);
      return;
    }

    const options: RequestOptions = {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
        "user-agent": USER_AGENT,
      },
      // The e2e server is loopback, which the guard refuses by design; every
      // other host in the world goes through it.
      ...(url.origin === testOrigin() ? {} : { lookup: guardedLookup }),
    };

    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, options);
    let settled = false;
    const finish = (answer: Answer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(null), remaining);

    request.on("error", () => finish(null));
    request.on("response", (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        finish(typeof location === "string" && location !== "" ? { redirectTo: location, html: "" } : null);
        return;
      }
      // A 404's own page is not this link's preview, and neither is a 500's.
      if (status !== 200) {
        finish(null);
        return;
      }
      const type = response.headers["content-type"] ?? "";
      if (!/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(type)) {
        finish(null);
        return;
      }

      // A StringDecoder rather than joining the chunks: a utf8 character can
      // straddle two of them, and a title with an accent in it should survive
      // arriving in halves.
      const decoder = new StringDecoder("utf8");
      let html = "";
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        // Past the cap the head has long since gone by: keep what is in hand and
        // stop reading rather than throwing the page away.
        const kept = bytes > MAX_BYTES ? chunk.subarray(0, chunk.length - (bytes - MAX_BYTES)) : chunk;
        html += decoder.write(kept);
        if (bytes >= MAX_BYTES) finish({ redirectTo: null, html: html + decoder.end() });
      });
      response.on("end", () => finish({ redirectTo: null, html: html + decoder.end() }));
      response.on("error", () => finish(null));
    });

    request.end();
  });
}

/** Follow up to three redirects, checking each destination as strictly as the first. */
async function fetchHtml(start: URL, deadline: number): Promise<{ url: URL; html: string } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(url)) return null;
    const answer = await get(url, deadline);
    if (answer === null) return null;
    if (answer.redirectTo === null) return { url, html: answer.html };
    try {
      url = new URL(answer.redirectTo, url);
    } catch {
      return null;
    }
  }
  // Three hops is a loop or a tracker, either way not a page worth the budget.
  return null;
}

/** An og:image the reader's browser will actually load: https on an https page. */
function displayable(image: string): boolean {
  try {
    const url = new URL(image);
    return url.protocol === "https:" || url.origin === testOrigin();
  } catch {
    return false;
  }
}

/**
 * The card for a url, or null when there is not one to be had.
 *
 * The row is keyed by the url as the peel wrote it, never by where the redirects
 * ended up: that url is what the hydrate looks up, and it is the only one the
 * reader can see. Relative og:image urls still resolve against the page that
 * declared them, which is the last hop.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!allowed(url)) return null;

  const page = await fetchHtml(url, Date.now() + BUDGET_MS);
  if (page === null) return null;

  const og = parseOpenGraph(page.html, page.url.href);
  return {
    url: rawUrl,
    title: og.title,
    description: og.description,
    image_url: og.imageUrl !== null && displayable(og.imageUrl) ? og.imageUrl : null,
  };
}

/**
 * Make sure a url has a card, and say nothing either way.
 *
 * Called from addPeel alongside the insert. A url already in the table is not
 * fetched again -- that is the whole point of keying on it -- and a page that
 * answers with no tags at all still earns its row, so the next hundred people to
 * share the same dull link do not each go and knock on it.
 *
 * Nothing in here may throw: a peel is posted whether or not its link has a card.
 */
export async function recordLinkPreview(
  supabase: SupabaseClient<Database>,
  url: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("link_previews")
      .select("url")
      .eq("url", url)
      .maybeSingle();
    if (existing) return;

    const preview = await fetchLinkPreview(url);
    if (preview === null) return;

    // 23505 is somebody else having posted the same link in the meantime, which
    // is the answer we wanted; the row is insert-once and theirs is as good.
    const { error } = await supabase.from("link_previews").insert(preview);
    if (error && error.code !== "23505") {
      console.error(`Couldn't record a link preview for ${url}: ${error.message}`);
    }
  } catch (error) {
    console.error(`Couldn't record a link preview for ${url}: ${String(error)}`);
  }
}
