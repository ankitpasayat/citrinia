import { withSerwist } from "@serwist/turbopack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 otherwise writes AGENTS.md/CLAUDE.md into the repo on `next dev`.
  agentRules: false,
};

// Only marks esbuild as a server external; the worker itself is built by
// app/serwist/[path]/route.ts, so the StyleX compile is untouched.
export default withSerwist(nextConfig);
