import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agent-lens/domain"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  experimental: { externalDir: true },
  async redirects() {
    return [
      { source: "/plans", destination: "/app/plans", permanent: false },
      { source: "/settings", destination: "/app/settings", permanent: false },
      { source: "/workstreams/:path*", destination: "/app/workstreams/:path*", permanent: false },
    ];
  },
};

export default withWorkflow(nextConfig);
