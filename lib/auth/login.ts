import "server-only";

import { createHash } from "node:crypto";

import { getAuthStore } from "../db";
import { clientIp } from "../rate-limit";
import { verifyPassword } from "./password";

/**
 * Password checking with shared, enumeration-safe throttling.
 *
 * Attempts are counted in the database, so limits hold across every app
 * instance, and each attempt is counted BEFORE the password is checked, in one
 * atomic step: a burst of simultaneous requests each takes its own slot, so
 * none can slip under the limit while the others are still hashing.
 *
 * Three counters, all keyed by hashes:
 *
 *   ip      — one address trying many usernames (spraying). Blocks.
 *   userip  — one address guessing one account; the tight limit. Blocks.
 *   user    — one account guessed from many addresses. Does NOT block: it only
 *             raises an alert. If it blocked, anyone who knew a colleague's
 *             username could keep them locked out from a handful of machines.
 *             The passwords it protects are at least 15 characters, which a
 *             distributed guesser cannot get through at these rates anyway.
 *
 * Unknown usernames are counted exactly like real ones, so a block never
 * reveals whether an account exists, and every outcome — wrong password,
 * unknown user, removed account, throttled — returns the same answer.
 */

const WINDOW_SECONDS = 15 * 60;
const LIMIT_IP = 50;
const LIMIT_USER_IP = 10;
const ALERT_USER = 100;

function key(scope: string, value: string): string {
  return `${scope}:${createHash("sha256").update(value).digest("hex")}`;
}

/** Same message for every failure. Says what to do without saying what was wrong. */
export const LOGIN_FAILED =
  "That username and password didn't match. Check them and try again — after several attempts, wait 15 minutes.";

/**
 * The person id when the credentials are right and nothing is throttled,
 * otherwise null.
 */
export async function checkLogin(
  request: Request,
  rawUsername: string,
  password: string,
): Promise<string | null> {
  const store = getAuthStore();
  const username = rawUsername.trim().toLowerCase();
  const ip = clientIp(request);
  const keys = [key("ip", ip), key("userip", `${username}\u0000${ip}`), key("user", username)];

  const [ipCount, userIpCount, userCount] = await store.throttleHit(keys, WINDOW_SECONDS);

  if (userCount === ALERT_USER + 1) {
    // Once per window. The key is a hash, so the log names no account.
    console.warn(`login: many failed attempts against one account (${keys[2].slice(0, 16)}…)`);
  }

  /*
   * Over a blocking limit, stop before the KDF: past the limit the expensive
   * hash would only hand an attacker a way to burn CPU. That fast path reveals
   * nothing about the account — it is reached by address, for any username.
   */
  if (ipCount > LIMIT_IP || userIpCount > LIMIT_USER_IP) return null;

  const login = username.length > 0 ? await store.findLogin(username) : null;
  const usable = login !== null && login.active;

  // Always exactly one full KDF, real or dummy, so timing does not tell them apart.
  const valid = await verifyPassword(password, usable ? login.passwordHash : null);
  if (!valid || !usable) return null;

  // Only this account-from-this-address counter resets; spraying counts stand.
  await store.throttleClear([keys[1]]);
  return login.personId;
}

/** Re-checks a signed-in person's own password, under the same throttle. */
export async function checkOwnPassword(
  request: Request,
  personId: string,
  password: string,
): Promise<boolean> {
  const store = getAuthStore();
  const keys = [key("reauth", personId), key("ip", clientIp(request))];
  const [personCount, ipCount] = await store.throttleHit(keys, WINDOW_SECONDS);
  if (personCount > LIMIT_USER_IP || ipCount > LIMIT_IP) return false;

  const valid = await verifyPassword(password, await store.getPasswordHash(personId));
  if (valid) await store.throttleClear([keys[0]]);
  return valid;
}

/** One dummy KDF, for request shapes that fail before a username is even read. */
export async function burnLoginAttempt(password: unknown): Promise<void> {
  await verifyPassword(typeof password === "string" ? password.slice(0, 1024) : "", null);
}
