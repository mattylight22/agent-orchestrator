export function isPublicPath(pathname: string) {
  return pathname === "/"
    || pathname === "/product"
    || pathname === "/security"
    || pathname === "/docs/setup"
    || pathname === "/login"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
    || pathname === "/api/auth/sign-in"
    || pathname === "/auth/confirm"
    || pathname.startsWith("/auth/github/callback");
}

export function safeProductDestination(value: string | null | undefined) {
  if (!value || value.startsWith("//")) return "/app";
  if (value === "/onboarding") return value;
  if (value === "/app" || value.startsWith("/app/") || value.startsWith("/app?")) return value;
  if (value === "/plans" || value.startsWith("/plans?")) return value;
  if (value === "/settings" || value.startsWith("/settings?")) return value;
  if (value.startsWith("/workstreams/")) return value;
  return "/app";
}

export function safeGithubConnectionDestination(value: string | null | undefined) {
  return value === "/onboarding" ? "/onboarding" : "/app/settings";
}
