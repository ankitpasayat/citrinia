import { withSerwist } from "@serwist/turbopack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 otherwise writes AGENTS.md/CLAUDE.md into the repo on `next dev`.
  agentRules: false,

  async redirects() {
    return [
      // Search became Explore. A 308 rather than a page that redirects, so the
      // hop costs nothing and `?q=` is carried across for free -- every link
      // ever shared out of the old screen still lands on its results.
      { source: "/search", destination: "/explore", permanent: true },
    ];
  },
};

// Only marks esbuild as a server external; the worker itself is built by
// app/serwist/[path]/route.ts, so the StyleX compile is untouched.
export default withSerwist(nextConfig);
