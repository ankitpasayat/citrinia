/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 otherwise writes AGENTS.md/CLAUDE.md into the repo on `next dev`.
  agentRules: false,
};

export default nextConfig;
