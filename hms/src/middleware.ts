import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/health", "/access-denied"];
const SESSION_COOKIES = ["hms_session", "__Host-hms_session"];

/**
 * Edge middleware: attaches a correlation id to every request and redirects obviously
 * unauthenticated requests to the login page. This is a UX convenience only - every page, action
 * and API re-validates the session and permissions on the server.
 */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);

  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasCookie = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!isPublic && !hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", requestId);
    return res;
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
