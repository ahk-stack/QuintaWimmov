/**
 * Fails if the Supabase service-role key appears in anything the browser
 * downloads.
 *
 * The app has no sign-in, so that key is the only thing protecting lead contact
 * data, direct messages and notification previews. A refactor that pulls a
 * server module into a client component would ship it silently; this catches
 * that after `next build`.
 *
 * Portable on purpose: plain Node, no shell tools, so it runs the same in any CI
 * (Bitbucket, Jenkins, GitHub Actions) and on Windows. Run after a build.
 *
 * The key is read from the environment, falling back to .env.local. It is never
 * printed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  }
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/);
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return null;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

if (!existsSync(STATIC_DIR)) {
  console.error("check-bundle: .next/static not found — run `npm run build` first.");
  process.exit(1);
}

const key = serviceKey();
if (!key) {
  /*
   * Nothing to search for. Not a failure, because a build without the key is
   * legitimate (the app then shows its setup screen) — but say so loudly rather
   * than reporting a pass that checked nothing.
   */
  console.warn("check-bundle: SKIPPED — no SUPABASE_SERVICE_ROLE_KEY available to search for.");
  process.exit(0);
}

let scanned = 0;
const leaks = [];
for (const file of files(STATIC_DIR)) {
  scanned++;
  if (readFileSync(file, "utf8").includes(key)) leaks.push(path.relative(process.cwd(), file));
}

if (leaks.length > 0) {
  console.error(`check-bundle: FAIL — the service-role key is in ${leaks.length} client file(s):`);
  for (const f of leaks) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-bundle: PASS — service-role key absent from ${scanned} client files.`);
