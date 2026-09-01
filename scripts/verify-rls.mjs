/**
 * Verifies the deployed schema and, more importantly, that the anon key cannot
 * read or write anything it should not. Run against the live project.
 *
 * Reads credentials from .env.local and never prints them.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const headers = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...extra,
});

async function get(path, key) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: headers(key) });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

async function post(path, key, payload) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: "POST",
    headers: headers(key, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

async function del(path, key) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: "DELETE",
    headers: headers(key),
  });
  return r.status;
}

const TABLES = [
  "people",
  "leads",
  "lead_events",
  "lead_comments",
  "channels",
  "messages",
  "news",
];

const pass = (b) => (b ? "PASS" : "FAIL <<<");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${pass(ok)}  ${label}${detail ? `  (${detail})` : ""}`);
};

console.log("1. All 7 tables exist (service_role)");
for (const t of TABLES) {
  const { status } = await get(`${t}?select=*&limit=1`, SVC);
  check(t, status === 200, `HTTP ${status}`);
}

console.log("\n2. Channels seeded");
{
  const { body } = await get("channels?select=slug&order=slug", SVC);
  const slugs = Array.isArray(body) ? body.map((c) => c.slug) : [];
  check("3 channels present", slugs.length === 3, slugs.join(", "));
}

console.log("\n3. anon CAN read the two tables Realtime chat needs");
for (const t of ["channels", "messages"]) {
  const { status, body } = await get(`${t}?select=id`, ANON);
  check(`anon reads ${t}`, status === 200 && Array.isArray(body), `HTTP ${status}`);
}

// Seed a temporary person + lead so the RLS read test has something to hide.
console.log("\n4. Seeding a temporary lead (service_role) to test RLS properly");
const personRes = await post("people", SVC, {
  name: "RLS Probe",
  email: `rls-probe-${Date.now()}@example.invalid`,
  role: "admin",
  initials: "RP",
});
const personId = Array.isArray(personRes.body) ? personRes.body[0]?.id : null;
check("temp person created", Boolean(personId), `HTTP ${personRes.status}`);

let leadId = null;
if (personId) {
  const leadRes = await post("leads", SVC, {
    created_by: personId,
    direction: "for_sales",
    hotel_name: "RLS Probe Hotel",
    contact_email: "secret-contact@example.invalid",
    contact_name: "Secret Contact",
  });
  leadId = Array.isArray(leadRes.body) ? leadRes.body[0]?.id : null;
  check("temp lead created", Boolean(leadId), `HTTP ${leadRes.status}`);
}

console.log("\n5. THE CRITICAL TEST: anon must NOT see lead contact data");
{
  const svcView = await get("leads?select=id,contact_email", SVC);
  const anonView = await get("leads?select=id,contact_email", ANON);
  const svcCount = Array.isArray(svcView.body) ? svcView.body.length : -1;
  const anonCount = Array.isArray(anonView.body) ? anonView.body.length : -1;
  check("service_role sees the lead", svcCount >= 1, `${svcCount} row(s)`);
  check(
    "anon sees ZERO leads",
    anonCount === 0,
    `${anonCount} row(s), HTTP ${anonView.status}`,
  );
  const leaked =
    JSON.stringify(anonView.body ?? "").includes("secret-contact") ||
    JSON.stringify(anonView.body ?? "").includes("Secret Contact");
  check("no contact data in the anon response", !leaked);
}

console.log("\n6. anon must NOT read the other private tables");
for (const t of ["people", "lead_events", "lead_comments", "news"]) {
  const { status, body } = await get(`${t}?select=*`, ANON);
  const rows = Array.isArray(body) ? body.length : -1;
  check(`anon reads 0 from ${t}`, rows === 0, `${rows} row(s), HTTP ${status}`);
}

console.log("\n7. anon must NOT be able to write anywhere");
{
  const chan = await get("channels?select=id&limit=1", SVC);
  const channelId = Array.isArray(chan.body) ? chan.body[0]?.id : null;

  const msg = await post("messages", ANON, {
    channel_id: channelId,
    author_id: personId,
    body: "anon should not be able to post this",
  });
  check("anon INSERT into messages refused", msg.status >= 400, `HTTP ${msg.status}`);

  const lead = await post("leads", ANON, {
    created_by: personId,
    direction: "for_sales",
    hotel_name: "Anon Injected Hotel",
  });
  check("anon INSERT into leads refused", lead.status >= 400, `HTTP ${lead.status}`);

  const person = await post("people", ANON, {
    name: "Anon Injected",
    email: `anon-inject-${Date.now()}@example.invalid`,
    role: "admin",
    initials: "AI",
  });
  check("anon INSERT into people refused", person.status >= 400, `HTTP ${person.status}`);
}

console.log("\n8. Cleaning up the probe rows");
if (leadId) check("lead deleted", (await del(`leads?id=eq.${leadId}`, SVC)) < 300);
if (personId)
  check("person deleted", (await del(`people?id=eq.${personId}`, SVC)) < 300);
{
  const { body } = await get("leads?select=id", SVC);
  check(
    "leads table back to empty",
    Array.isArray(body) && body.length === 0,
    `${Array.isArray(body) ? body.length : "?"} row(s)`,
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
