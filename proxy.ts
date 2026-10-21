import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends visitors without a session cookie to the sign-in page before any page
 * work starts.
 *
 * This is a CONVENIENCE, not the protection. It only looks for the cookie's
 * presence — it never touches the database — so a forged or expired cookie
 * passes straight through. Every page calls `requireUser()` and every route
 * handler calls `authorize()`, and those are what actually refuse access. API
 * routes are excluded so they answer 401 JSON rather than an HTML redirect.
 */

const SESSION_COOKIES = ["__Host-leadhub_session", "leadhub_session"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except: the sign-in page, API routes, Next's own assets,
     * robots.txt, the favicon and the brand files the sign-in page shows.
     */
    "/((?!login|api/|_next/static|_next/image|robots\\.txt|favicon\\.ico|brand/).*)",
  ],
};
