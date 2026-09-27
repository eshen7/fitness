import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Everything is behind the passcode except the unlock page itself and the routes
 * nothing with a session ever calls: the WHOOP webhook, which WHOOP posts to directly
 * and which authenticates by HMAC signature, and the two scheduled jobs, which the
 * scheduler calls with a bearer. All three authenticate themselves - the jobs through
 * `cronAuthorized`, which refuses the bearer path entirely when `CRON_SECRET` is unset
 * rather than accepting anything.
 */
const PUBLIC_PATHS = [
  "/unlock",
  "/api/whoop/webhook",
  "/api/whoop/sync",
  "/api/insights",
  "/manifest.webmanifest",
  "/sw.js",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // API routes get a status, not a redirect, so the offline queue can tell the
  // difference between "locked out" and "network down".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|favicon.ico).*)"],
};
