/// <reference lib="webworker" />
// The service worker. Precaches the build's static assets (chunks, the StyleX
// css, the fonts, the icons) and /offline; everything else follows Serwist's
// defaults -- pages network-first, images stale-while-revalidate -- except
// Supabase, which is never served from a cache: auth, REST, realtime and the
// media bucket all answer per user and per moment.
// `defaultCache` is built from @serwist/turbopack's own copy of serwist. The
// `browserslist` override in package.json keeps that copy and ours the same
// package instance; split in two, Serwist's `instanceof Strategy` check skips
// the offline fallback on every default handler and a page load with no
// network fails instead of showing /offline.
import { defaultCache } from "@serwist/turbopack/worker";
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ url }) => url.hostname.endsWith(".supabase.co"), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
