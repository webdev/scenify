import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Always allow Auth.js endpoints and the sign-in page itself.
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/admin/sign-in") return NextResponse.next();

  const session = req.auth;
  const isAdmin =
    session?.user &&
    (session.user as { isAdmin?: boolean }).isAdmin === true;

  if (!isAdmin) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/sign-in";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Run on every path except static assets + Next.js internals.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf)).*)",
  ],
};
