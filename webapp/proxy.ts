import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isPublicPath, safeProductDestination } from "./lib/routes";

export default clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/.well-known/workflow/")) return NextResponse.next();

  const { userId } = await auth();
  if (!userId && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  if (userId && pathname === "/login") {
    return NextResponse.redirect(new URL(safeProductDestination(request.nextUrl.searchParams.get("next")), request.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
