import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker at /serwist/sw.js. esbuild bundles app/sw.ts while
// `next build` prerenders this route, so on Vercel it is a static file; nothing
// runs at request time. The precache manifest is the build's own static assets
// plus /offline, whose revision only has to change when a deploy does.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  // The default on Linux is the wasm build, which is not installed.
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: "/offline", revision }],
});
