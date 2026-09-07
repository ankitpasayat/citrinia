// Spec: posting a peel with a link in it goes and reads that page's Open Graph
// tags, on a three-second budget, and a slow or hostile page means no card
// rather than a slow post. The url comes from a stranger, so what this file is
// really about is everywhere the fetch must refuse to go.
//
// The pages below are served by the test itself, on loopback -- which is exactly
// what the address guard exists to refuse, so the suite names that one origin in
// LINK_PREVIEW_TEST_ORIGIN. With the variable unset (production, always) the
// same fetch is refused, and that is asserted here too.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { fetchLinkPreview, guardedLookup } from "./link-preview-fetch.ts";

let server: Server;
let origin: string;
const sockets = new Set<Socket>();
/** How often the page a redirect tried to reach was actually served. Must stay 0. */
let elsewhereServed = 0;

const OG_PAGE = `<!doctype html><html><head>
  <meta property="og:title" content="Ada &amp; the peel">
  <meta property="og:description" content="What a citrus knows.">
  <meta property="og:image" content="/card.png">
</head><body>nothing to see</body></html>`;

function html(response: ServerResponse, body: string, status = 200): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

/** The port the suite is serving on, for the redirect that must not be followed. */
function port(): number {
  return Number(new URL(origin).port);
}

before(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    switch (path) {
      case "/og":
        return html(response, OG_PAGE);
      case "/bare":
        return html(response, "<html><head><title>Just a title</title></head><body>hi</body></html>");
      case "/missing":
        return html(response, "<html><head><title>Gone</title></head></html>", 404);
      case "/plain":
        response.writeHead(200, { "content-type": "text/plain" });
        return response.end("not a page");
      case "/to-metadata":
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return response.end();
      case "/to-elsewhere":
        // Same server, a different origin: "localhost" is not the origin the
        // suite named, so nothing here may follow it. If anything does, the
        // counter says so -- a null result alone would not, since the guard
        // that stops it also stops an unreachable address.
        response.writeHead(302, { location: `http://localhost:${port()}/elsewhere` });
        return response.end();
      case "/elsewhere":
        elsewhereServed += 1;
        return html(response, `<html><head><title>Elsewhere</title></head></html>`);
      case "/to-og":
        response.writeHead(302, { location: "/og" });
        return response.end();
      case "/loop":
        response.writeHead(302, { location: "/loop" });
        return response.end();
      case "/huge":
        response.writeHead(200, { "content-type": "text/html" });
        response.write(`<html><head><title>Big</title></head><body>`);
        // Well past the half-megabyte cap: the head is long gone by then.
        return response.end("x".repeat(2 * 1024 * 1024));
      case "/slow":
        // Headers, then silence. This is the case the budget exists for.
        response.writeHead(200, { "content-type": "text/html" });
        response.write("<html><head>");
        return;
      default:
        response.writeHead(404);
        return response.end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Run something with the e2e exception in place, and put the environment back. */
async function withTestOrigin<T>(run: () => Promise<T>): Promise<T> {
  const before = process.env.LINK_PREVIEW_TEST_ORIGIN;
  process.env.LINK_PREVIEW_TEST_ORIGIN = origin;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.LINK_PREVIEW_TEST_ORIGIN;
    else process.env.LINK_PREVIEW_TEST_ORIGIN = before;
  }
}

test("a page with og tags becomes a card, keyed by the url as the peel wrote it", async () => {
  const preview = await withTestOrigin(() => fetchLinkPreview(`${origin}/og`));
  assert.deepEqual(preview, {
    url: `${origin}/og`,
    title: "Ada & the peel",
    description: "What a citrus knows.",
    image_url: `${origin}/card.png`,
  });
});

test("a page with no og tags still gets a row -- the compact row", async () => {
  const preview = await withTestOrigin(() => fetchLinkPreview(`${origin}/bare`));
  assert.deepEqual(preview, {
    url: `${origin}/bare`,
    title: "Just a title",
    description: null,
    image_url: null,
  });
});

test("without the test origin named, loopback is refused -- which is production", async () => {
  const before = process.env.LINK_PREVIEW_TEST_ORIGIN;
  delete process.env.LINK_PREVIEW_TEST_ORIGIN;
  try {
    assert.equal(await fetchLinkPreview(`${origin}/og`), null);
  } finally {
    if (before !== undefined) process.env.LINK_PREVIEW_TEST_ORIGIN = before;
  }
});

test("nothing but http(s) is followed at all", async () => {
  for (const url of ["file:///etc/passwd", "ftp://ada.dev/x", "not a url", ""]) {
    assert.equal(await withTestOrigin(() => fetchLinkPreview(url)), null, url);
  }
});

test("a redirect is followed, and its destination is checked as strictly as the first url", async () => {
  const followed = await withTestOrigin(() => fetchLinkPreview(`${origin}/to-og`));
  assert.equal(followed?.title, "Ada & the peel");
  // The classic way past a guard that only reads the url somebody typed.
  assert.equal(await withTestOrigin(() => fetchLinkPreview(`${origin}/to-metadata`)), null);
  // And one whose destination this very server would answer, so "it came back
  // null" cannot be the unreachable address doing the work.
  assert.equal(await withTestOrigin(() => fetchLinkPreview(`${origin}/to-elsewhere`)), null);
  assert.equal(elsewhereServed, 0, "a redirect reached a page the fetch had no business opening");
  // And a redirect that never lands gives up rather than spinning.
  assert.equal(await withTestOrigin(() => fetchLinkPreview(`${origin}/loop`)), null);
});

test("a page that is not html, or not there, is not a card", async () => {
  assert.equal(await withTestOrigin(() => fetchLinkPreview(`${origin}/plain`)), null);
  assert.equal(await withTestOrigin(() => fetchLinkPreview(`${origin}/missing`)), null);
});

test("a page past the size cap is cut off, and its head still reads", async () => {
  const preview = await withTestOrigin(() => fetchLinkPreview(`${origin}/huge`));
  assert.equal(preview?.title, "Big");
});

test("a page that stops answering costs three seconds and no more", async () => {
  const started = Date.now();
  const preview = await withTestOrigin(() => fetchLinkPreview(`${origin}/slow`));
  const took = Date.now() - started;
  assert.equal(preview, null);
  assert.ok(took >= 2_500, `gave up after ${took}ms, which is not the budget`);
  assert.ok(took < 5_000, `took ${took}ms, so nothing bounded it`);
});

//------------------------------------------------------------------------------
// The guard the fetch installs on every connection it makes
//------------------------------------------------------------------------------

/** dns.lookup answers a numeric address without asking anybody, so this stays offline. */
function look(hostname: string, options = {}): Promise<{ error: unknown; address: unknown }> {
  return new Promise((resolve) => {
    guardedLookup(hostname, options, (error, address) => resolve({ error, address }));
  });
}

test("the lookup refuses a name that resolves somewhere only this server can reach", async () => {
  for (const hostname of ["127.0.0.1", "localhost", "10.0.0.1", "169.254.169.254", "::1"]) {
    const { error, address } = await look(hostname);
    assert.ok(error, `${hostname} was allowed`);
    assert.equal(address, "");
  }
});

test("the lookup passes an address out on the internet through, in either shape", async () => {
  const one = await look("93.184.216.34");
  assert.equal(one.error, null);
  assert.equal(one.address, "93.184.216.34");

  const all = await look("93.184.216.34", { all: true });
  assert.equal(all.error, null);
  assert.deepEqual(all.address, [{ address: "93.184.216.34", family: 4 }]);
});
