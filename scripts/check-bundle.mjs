/**
 * Fails if the Supabase service-role key appears anywhere in the build output.
 *
 * The app has no sign-in, so that key is the only thing protecting lead contact
 * data, direct messages and notification previews. A refactor that pulls a
 * server module into a client component would ship it silently; this catches
 * that after `next build`.
 *
 * FAILS CLOSED. With no key to search for it exits non-zero rather than
 * "skipping": a clean CI runner has neither the variable nor .env.local, and a
 * check that passes there has verified nothing. `npm run check` always supplies
 * a value (the real key, or a sentinel it builds with), so use that; run this
 * directly only after a build whose key you know.
 *
 * The key is resolved with @next/env — the same loader, file precedence and
 * dotenv syntax (quotes, comments, expansion) Next itself uses — so the string
 * searched for is exactly the string Next would have had. It is never printed.
 *
 * WHAT IS SCANNED: all of .next except the build caches — not just
 * .next/static. A Server Component or a statically generated route that renders
 * the key writes it into prerendered HTML/RSC on the server side of the tree,
 * which is still served to browsers. Rather than track where a given Next
 * version puts those files, everything is scanned. That cannot false-positive:
 * Next never inlines a non-NEXT_PUBLIC variable into any artefact, server
 * bundles included, so the key legitimately appears nowhere in the output.
 *
 * WHAT IS NOT: a dynamically rendered page that prints the key leaks it only at
 * request time, after the build. No build-output check can see that; it is
 * covered by code review and the AGENTS.md rules instead.
 *
 * Plain Node, no shell tools: runs the same in any CI and on Windows.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";

const BUILD_DIR = path.join(process.cwd(), ".next");
const STATIC_DIR = path.join(BUILD_DIR, "static");
// Build caches and dev-server state: not output, and not shipped.
const SKIP = new Set([path.join(BUILD_DIR, "cache"), path.join(BUILD_DIR, "dev")]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP.has(full)) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

if (!existsSync(STATIC_DIR)) {
  console.error("check-bundle: FAIL — .next/static not found; build first.");
  process.exit(1);
}

// Production semantics, matching `next build`. Explicit env vars win, as in Next.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

if (key.length < 16) {
  console.error(
    "check-bundle: FAIL — no SUPABASE_SERVICE_ROLE_KEY to search for, so nothing " +
      "would be verified. Run `npm run check`, which builds with a sentinel when no " +
      "real key is configured.",
  );
  process.exit(1);
}

let scanned = 0;
const leaks = [];
for (const file of files(BUILD_DIR)) {
  scanned++;
  if (readFileSync(file, "utf8").includes(key)) {
    leaks.push(path.relative(process.cwd(), file));
  }
}

if (scanned === 0) {
  console.error("check-bundle: FAIL — the build directory is empty.");
  process.exit(1);
}

if (leaks.length > 0) {
  console.error(`check-bundle: FAIL — the service-role key is in ${leaks.length} build file(s):`);
  for (const f of leaks) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-bundle: PASS — service-role key absent from all ${scanned} build files.`);
