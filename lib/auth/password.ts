import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and verification.
 *
 * scrypt from node:crypto rather than a native bcrypt/argon2 module: no build
 * step, nothing extra in the container, and it is a memory-hard KDF that OWASP
 * lists as acceptable. Parameters follow OWASP's scrypt guidance (N=2^15, r=8,
 * p=3) — about 185 ms per verify on a laptop, which is the point: it makes a
 * stolen hash expensive to guess, and it is why logins are throttled before the
 * KDF ever runs.
 *
 * Stored as a self-describing string, `scrypt$<log2 N>$<r>$<p>$<salt>$<key>`,
 * so parameters can be raised later without invalidating existing hashes. The
 * parser only accepts a narrow range, because the string comes from the
 * database and an absurd N would let a corrupted row stall the server.
 *
 * scripts/bootstrap-admin.mjs writes the same format. Change both together.
 */

const LOG_N = 15;
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/*
 * scrypt needs about 128 × N × r bytes — 32 MiB here — and Node's default
 * ceiling is exactly 32 MiB, which rejects. Raised deliberately, with headroom
 * for the largest N the parser accepts at a lower p.
 */
const MAX_MEMORY = 160 * 1024 * 1024;

/*
 * Each verify holds ~32 MiB and a libuv thread for ~200 ms. Unbounded, a burst
 * of logins could exhaust memory or starve every other request of the thread
 * pool. Excess calls wait their turn instead.
 */
const MAX_CONCURRENT = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function derive(
  password: string,
  salt: Buffer,
  logN: number,
  r: number,
  p: number,
  keyBytes: number,
): Promise<Buffer> {
  return withSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          keyBytes,
          { N: 2 ** logN, r, p, maxmem: MAX_MEMORY },
          (error, key) => (error ? reject(error) : resolve(key)),
        );
      }),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, LOG_N, R, P, KEY_BYTES);
  return [
    "scrypt",
    LOG_N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

interface Parsed {
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

/** Null for anything outside the narrow range this module ever writes. */
function parse(encoded: string): Parsed | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [logN, r, p] = parts.slice(1, 4).map((v) => Number(v));
  if (!Number.isInteger(logN) || logN < 14 || logN > 17) return null;
  if (r !== 8) return null;
  if (!Number.isInteger(p) || p < 1 || p > 4) return null;

  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;

  return { logN, r, p, salt, key };
}

/**
 * A real hash of a random password that was thrown away.
 *
 * Verifying against it when the username does not exist means an unknown
 * username costs the same KDF time as a wrong password, so response time does
 * not reveal which usernames are real. It is a constant rather than computed
 * on first use: computing it would cost a second KDF on a cold instance, and
 * that difference is exactly what an attacker would time. It unlocks nothing.
 */
const DUMMY_HASH = "scrypt$15$8$3$MVV2gg8hbyETGn58gQpyzg$K3YsZk0OvoJ31kAnIZgGuEg6KLjxLPK2-_L1ZD0Tzn4";

/**
 * True only for the right password.
 *
 * With no hash (unknown or disabled account) it still runs one full KDF
 * against a dummy and returns false, so every failure path takes the same time.
 */
export async function verifyPassword(
  password: string,
  encoded: string | null,
): Promise<boolean> {
  const parsed = encoded ? parse(encoded) : null;
  if (!parsed) {
    const dummy = parse(DUMMY_HASH);
    if (dummy) await derive(password, dummy.salt, dummy.logN, dummy.r, dummy.p, dummy.key.length);
    return false;
  }

  const candidate = await derive(
    password,
    parsed.salt,
    parsed.logN,
    parsed.r,
    parsed.p,
    parsed.key.length,
  );
  // Lengths are equal by construction; timingSafeEqual throws otherwise.
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

// Policy ----------------------------------------------------------------------

// Shared with scripts/bootstrap-admin.mjs, so the first admin meets the same bar.
export { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "./password-policy.mjs";
