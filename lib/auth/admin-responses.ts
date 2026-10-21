import "server-only";

import { AccountError, type AccountErrorCode } from "../db/auth-store";
import { PRIVATE_HEADERS } from "./guard";

/**
 * Maps a refused account change to a response.
 *
 * The messages are written for the admin looking at the screen. None of them
 * repeat submitted values.
 */
const ANSWERS: Record<AccountErrorCode, { status: number; error: string; field?: string }> = {
  not_admin: { status: 403, error: "Only admins can do that." },
  last_admin: { status: 409, error: "That would leave no admin able to sign in." },
  self: { status: 409, error: "You can't remove your own admin access or delete yourself." },
  not_found: { status: 404, error: "That person no longer exists." },
  username_taken: { status: 409, error: "That username is taken.", field: "username" },
  email_taken: { status: 409, error: "Someone already has that email.", field: "email" },
  credentials_required: { status: 400, error: "A first sign-in needs both a username and a password." },
  nothing_to_change: { status: 400, error: "Nothing to change." },
  already_bootstrapped: { status: 409, error: "Sign-in is already set up." },
};

export function accountErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof AccountError) {
    const answer = ANSWERS[error.code];
    return Response.json(
      { error: answer.error, ...(answer.field ? { fields: { [answer.field]: answer.error } } : {}) },
      { status: answer.status, headers: PRIVATE_HEADERS },
    );
  }
  return Response.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}
