export function isPublicPath(pathname: string) {
  return pathname === "/"
    || pathname === "/product"
    || pathname === "/security"
    || pathname === "/docs/setup"
    || pathname === "/login"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
    || pathname === "/api/auth/sign-in"
    || pathname.startsWith("/auth/github/callback");
}

export function safeProductDestination(value: string | null | undefined) {
  if (!value || value.startsWith("//")) return "/app";
  if (value === "/app" || value.startsWith("/app/") || value.startsWith("/app?")) return value;
  if (value === "/plans" || value.startsWith("/plans?")) return value;
  if (value === "/settings" || value.startsWith("/settings?")) return value;
  if (value.startsWith("/workstreams/")) return value;
  return "/app";
}
