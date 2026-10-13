/**
 * `npm run check` — the full pre-merge gate, runnable in any CI.
 *
 *   typecheck -> lint -> build -> bundle check -> production audit
 *
 * The bundle check needs a service-role key to search for. A clean CI runner has
 * none, and a check with nothing to search for verifies nothing. So when no real
 * key is configured, this builds with a SENTINEL value in its place and searches
 * for that. Any code path that would leak the real key leaks the sentinel the
 * same way, so the check is meaningful with or without credentials, and never
 * needs the real secret in CI.
 *
 * Plain Node, no shell tools: identical on a Linux runner and on Windows.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";

// Same loader, precedence and dotenv syntax as `next build`.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

const env = { ...process.env };
let usingSentinel = false;
if (!(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()) {
  // Long and unique per run, so it cannot collide with anything in a bundle.
  env.SUPABASE_SERVICE_ROLE_KEY = `check-sentinel-${randomUUID()}-${randomUUID()}`;
  usingSentinel = true;
}

console.log(
  usingSentinel
    ? "check: no service-role key configured — building with a sentinel in its place."
    : "check: using the configured service-role key for the bundle check (never printed).",
);

const steps = [
  ["typecheck", "npm run typecheck"],
  ["lint", "npm run lint"],
  ["build", "npm run build"],
  ["bundle", "node scripts/check-bundle.mjs"],
  // Blocking on what ships. Dev tooling can carry advisories with no upstream
  // fix (braces <=3.0.3 via eslint-config-next has none at all) that never
  // reach production.
  ["audit", "npm audit --omit=dev --audit-level=high"],
];

for (const [name, command] of steps) {
  console.log(`\ncheck: ── ${name} ──`);
  const result = spawnSync(command, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) {
    console.error(`\ncheck: FAILED at "${name}".`);
    process.exit(result.status ?? 1);
  }
}

console.log("\ncheck: all steps passed.");
