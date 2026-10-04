import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "rhl_session";
/** Pages anyone can open. Everything else is an app screen and needs a session. */
const PUBLIC_PATHS = new Set(["/", "/login"]);

/**
 * Optimistic check only (no database/API call): no session cookie on an app screen → send to /login and come
 * back afterwards. The (app) layout then validates the session against the API.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.nextUrl);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip API calls, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
