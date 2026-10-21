import "server-only";

/**
 * Cross-site request forgery protection for route handlers.
 *
 * The session cookie is SameSite=Lax, which already stops most cross-site
 * POSTs. This is the second layer, because Lax still sends the cookie in some
 * same-site cases (a sibling subdomain), and because Next applies its own
 * origin check to Server Actions but not to route handlers.
 *
 * A state-changing request must:
 *   1. not be labelled cross-site or same-site by the browser (Fetch Metadata);
 *   2. carry an Origin that is this app;
 *   3. be JSON — a cross-origin form cannot send that without a CORS preflight,
 *      which this app never answers.
 *
 * Login and logout are covered too: forging a login would sign the victim into
 * an account the attacker controls.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The origin requests must come from.
 *
 * `APP_ORIGIN` when set (recommended behind a reverse proxy). Otherwise the
 * Host header: a browser always sends the real Host and Origin for the page it
 * is on, so an attacker's page produces an Origin that differs from it. Only
 * the host part is compared in that case, because a TLS-terminating proxy can
 * make the app see http while the browser says https.
 */
function originMatches(request: Request, origin: string): boolean {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return origin === configured;

  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True when the request may change state. Safe methods always pass. */
export function isSameOriginRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const site = request.headers.get("sec-fetch-site");
  // Absent on older browsers; Origin below is then the whole check.
  if (site !== null && site !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin || !originMatches(request, origin)) return false;

  const type = request.headers.get("content-type") ?? "";
  return type.toLowerCase().startsWith("application/json");
}
