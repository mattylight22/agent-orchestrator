import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/product", "/security", "/docs/setup", "/login"], disallow: ["/app", "/api"] },
    sitemap: "https://agentgodmode.dev/sitemap.xml",
  };
}
