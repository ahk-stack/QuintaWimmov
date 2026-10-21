/**
 * `npm run bootstrap-admin -- --email you@quinta.im --username your.name`
 *
 * Gives the FIRST admin a sign-in, from a terminal. After that, admins manage
 * everyone else from Manage users in the app.
 *
 *   --email <address> | --name "<Full Name>"   which admin (must have role admin)
 *   --username <name>                          3–32 of a-z 0-9 . _ -
 *   --force                                    break-glass: allowed even when
 *                                              sign-ins already exist, e.g. the
 *                                              only admin forgot their password
 *
 * The password is typed at a hidden prompt (twice), or read from stdin when
 * piped. It is never echoed, logged, or passed on the command line, where it
 * would land in shell history.
 *
 * Runs against Supabase when SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY are set, otherwise against the local dev store in
 * .data/db.json (restart `npm run dev` afterwards, since it caches the file).
 *
 * The hash format must match lib/auth/password.ts exactly. Change both together.
 */
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import nextEnv from "@next/env";

import { passwordProblem } from "../lib/auth/password-policy.mjs";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

function fail(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

// Arguments -------------------------------------------------------------------

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const email = option("email")?.trim().toLowerCase();
const name = option("name")?.trim();
const username = option("username")?.trim().toLowerCase();
const force = args.includes("--force");

if (!email === !name) fail("give exactly one of --email or --name.");
if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  fail("--username must be 3–32 characters: a-z, 0-9, dot, dash or underscore.");
}

// Password --------------------------------------------------------------------

/** Reads one line without echoing it. */
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  // Only the line terminator is removed; the password is otherwise exact.
  return data.replace(/\r?\n$/, "");
}

let password;
if (process.stdin.isTTY) {
  password = await promptHidden("New password (hidden): ");
  const again = await promptHidden("Same again: ");
  if (password !== again) fail("the two passwords differ. Nothing was changed.");
} else {
  password = await readPiped();
}

// The same rules the app applies to everyone else.
const problem = passwordProblem(password, username);
if (problem) fail(`${problem.toLowerCase()}. Nothing was changed.`);

// Hash (same format as lib/auth/password.ts) ------------------------------------

const LOG_N = 15;
const R = 8;
const P = 3;
const salt = randomBytes(16);
const key = await new Promise((resolve, reject) =>
  scrypt(password, salt, 32, { N: 2 ** LOG_N, r: R, p: P, maxmem: 160 * 1024 * 1024 }, (e, k) =>
    e ? reject(e) : resolve(k),
  ),
);
const passwordHash = ["scrypt", LOG_N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");

// Write -----------------------------------------------------------------------

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (url && serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const filter = email ? `email=eq.${encodeURIComponent(email)}` : `name=eq.${encodeURIComponent(name)}`;
  const found = await fetch(`${url}/rest/v1/people?select=id,role,active&${filter}`, { headers });
  if (!found.ok) fail(`could not read the roster (HTTP ${found.status}).`);
  const people = await found.json();
  if (people.length !== 1) fail(`expected exactly one person to match, found ${people.length}.`);
  const [person] = people;
  if (!person.active || person.role !== "admin") fail("that person is not an active admin.");

  const response = await fetch(`${url}/rest/v1/rpc/bootstrap_set_credentials`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_person: person.id,
      p_username: username,
      p_password_hash: passwordHash,
      p_force: force,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = String(body.message ?? "");
    if (message.includes("LH_ALREADY_BOOTSTRAPPED")) {
      fail("sign-ins already exist. Ask an admin to set yours in the app, or rerun with --force to recover.");
    }
    if (message.includes("person_credentials_username_key")) fail("that username is taken.");
    if (response.status === 404) fail("the database function is missing. Apply migration 0007 first.");
    fail(`the database refused (HTTP ${response.status}).`);
  }
  console.log(`bootstrap-admin: done. ${username} can now sign in. Every earlier session of theirs has ended.`);
} else {
  const file = path.join(process.cwd(), ".data", "db.json");
  let db;
  try {
    db = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(
      "no Supabase variables and no .data/db.json yet. Start `npm run dev` and open " +
        "http://localhost:3000/api/health once — that creates the seeded dev store — then rerun this.",
    );
  }
  db.credentials ??= [];
  db.sessions ??= [];
  db.adminAudit ??= [];

  const matches = db.people.filter((p) =>
    email ? (p.email ?? "").toLowerCase() === email : p.name === name,
  );
  if (matches.length !== 1) fail(`expected exactly one person to match, found ${matches.length}.`);
  const [person] = matches;
  if (!person.active || person.role !== "admin") fail("that person is not an active admin.");
  if (!force && db.credentials.length > 0) {
    fail("sign-ins already exist. Rerun with --force to recover.");
  }
  if (db.credentials.some((c) => c.username === username && c.personId !== person.id)) {
    fail("that username is taken.");
  }

  db.credentials = db.credentials.filter((c) => c.personId !== person.id);
  db.credentials.push({
    personId: person.id,
    username,
    passwordHash,
    passwordChangedAt: new Date().toISOString(),
  });
  db.sessions = db.sessions.filter((s) => s.personId !== person.id);
  db.adminAudit.push({
    id: randomUUID(),
    actorId: null,
    targetId: person.id,
    action: "bootstrap",
    createdAt: new Date().toISOString(),
  });

  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await rename(tmp, file);
  console.log(`bootstrap-admin: done (dev store). Restart \`npm run dev\`, then sign in as ${username}.`);
}
