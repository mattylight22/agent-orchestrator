import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agent-lens/domain"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  experimental: { externalDir: true },
};

export default withWorkflow(nextConfig);
