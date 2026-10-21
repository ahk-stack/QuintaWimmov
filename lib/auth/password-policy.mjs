/**
 * The password rules, in one place.
 *
 * Plain JavaScript so that both the app (lib/auth/password.ts) and the
 * terminal bootstrap script (scripts/bootstrap-admin.mjs) import the same
 * rules — the first admin's password must meet exactly the bar everyone else's
 * does. Holds no secrets, so it carries no `server-only` guard.
 *
 * Length is what matters; there are no composition rules, spaces and any
 * script are allowed, and the value is never trimmed or normalised — the
 * password is exactly what was typed.
 */

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;

/*
 * A short local list of the passwords that survive a length rule. Not a breach
 * corpus — that would need a download or an external API — but it stops the
 * obvious choices an admin might type when setting up 70 accounts.
 */
const COMMON = new Set([
  "passwordpassword",
  "password12345678",
  "123456789012345",
  "1234567890123456",
  "qwertyuiopasdfgh",
  "quintaquintaquinta",
  "quinta123456789",
  "welcome123456789",
  "changemechangeme",
  "leadhubleadhub12",
  "aaaaaaaaaaaaaaa",
]);

/**
 * Returns a message to show, or null when the password is acceptable.
 *
 * @param {string} password
 * @param {string | null | undefined} [username] the username it will belong to
 * @returns {string | null}
 */
export function passwordProblem(password, username) {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (length > PASSWORD_MAX) return `Keep it under ${PASSWORD_MAX} characters`;

  const folded = password.toLowerCase();
  if (COMMON.has(folded)) return "That password is too common";
  if (/^(.)\1+$/u.test(password)) return "That password is too easy to guess";
  if (username && folded.includes(username.toLowerCase())) {
    return "Don't include the username in the password";
  }
  return null;
}
