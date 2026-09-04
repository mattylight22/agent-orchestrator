import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://agentgodmode.dev";
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/product`, changeFrequency: "monthly", priority: .8 },
    { url: `${base}/security`, changeFrequency: "monthly", priority: .7 },
    { url: `${base}/docs/setup`, changeFrequency: "monthly", priority: .8 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: .2 },
  ];
}
