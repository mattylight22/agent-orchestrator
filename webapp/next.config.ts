import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agent-lens/domain"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  experimental: { externalDir: true },
  webpack(config) {
    // @getpaseo/relay publishes browser exports that point at omitted source files.
    // Resolve the shipped E2EE implementation so the Paseo SDK can run in-browser
    // for direct Tailscale connections.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@getpaseo/relay/e2ee": new URL("./node_modules/@getpaseo/relay/dist/e2ee.js", import.meta.url).pathname,
    };
    return config;
  },
  async redirects() {
    return [
      { source: "/plans", destination: "/app/plans", permanent: false },
      { source: "/settings", destination: "/app/settings", permanent: false },
      { source: "/workstreams/:path*", destination: "/app/workstreams/:path*", permanent: false },
    ];
  },
};

export default withWorkflow(nextConfig);
