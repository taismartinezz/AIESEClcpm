import { type NextRequest, NextResponse } from "next/server";

// Routes that use their own non-JWT auth (CRON_SECRET, INTERNAL_API_SECRET)
// or are intentionally public.
const BYPASS_PREFIXES = [
  "/api/cron/",
];

/**
 * Lightweight auth gate: reject any /api/* request that has no Bearer token
 * before it even reaches the route handler. Full JWT validation still happens
 * inside each handler via requireAuth(); this is a fast first-pass filter that
 * prevents completely unauthenticated access without the per-route overhead on
 * every call.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Let bypass routes through unconditionally
  if (BYPASS_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const auth = request.headers.get("Authorization") ?? "";
  const hasBearer = auth.startsWith("Bearer ") && auth.length > 7;

  if (!hasBearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
