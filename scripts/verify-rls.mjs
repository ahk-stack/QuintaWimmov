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
  "direct_messages",
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
/*
 * Record the baseline before touching anything. Asserting an empty table at the
 * end would make this script unusable the moment the app holds real leads,
 * which is exactly when verifying RLS matters most.
 */
const baselineLeads = await (async () => {
  const { body } = await get("leads?select=id", SVC);
  return Array.isArray(body) ? body.length : -1;
})();
console.log(`\nBaseline: ${baselineLeads} lead(s) already in the project`);

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
for (const t of ["people", "lead_events", "lead_comments", "news", "direct_messages"]) {
  const { status, body } = await get(`${t}?select=*`, ANON);
  const rows = Array.isArray(body) ? body.length : -1;
  check(`anon reads 0 from ${t}`, rows === 0, `${rows} row(s), HTTP ${status}`);
}

console.log("\n6b. THE DM BOUNDARY: a planted direct message must be invisible to anon");
{
  const CANARY = `dm-canary-${Date.now()}-do-not-leak`;
  /*
   * Baseline first. Asserting an empty table after cleanup would fail on any
   * project with real DM traffic — the same trap the lead probe above avoids.
   */
  const baselineDms = await (async () => {
    const { body } = await get("direct_messages?select=id", SVC);
    return Array.isArray(body) ? body.length : -1;
  })();
  const two = await get("people?select=id&limit=2", SVC);
  const pair = Array.isArray(two.body) ? two.body : [];

  if (pair.length < 2) {
    check("two people available to plant a DM", false, "roster too small");
  } else {
    const planted = await post("direct_messages", SVC, {
      sender_id: pair[0].id,
      recipient_id: pair[1].id,
      body: CANARY,
    });
    const dmId = Array.isArray(planted.body) ? planted.body[0]?.id : null;
    check("DM planted with service_role", Boolean(dmId), `HTTP ${planted.status}`);

    const svcView = await get("direct_messages?select=body", SVC);
    check("service_role can read it", JSON.stringify(svcView.body ?? "").includes(CANARY));

    const anonView = await get("direct_messages?select=*", ANON);
    const rows = Array.isArray(anonView.body) ? anonView.body.length : -1;
    check("anon sees ZERO direct messages", rows === 0, `${rows} row(s)`);
    check(
      "canary text absent from the anon response",
      !JSON.stringify(anonView.body ?? "").includes(CANARY),
    );

    const anonWrite = await post("direct_messages", ANON, {
      sender_id: pair[0].id,
      recipient_id: pair[1].id,
      body: "anon should not write",
    });
    check("anon INSERT into direct_messages refused", anonWrite.status >= 400, `HTTP ${anonWrite.status}`);

    const selfDm = await post("direct_messages", SVC, {
      sender_id: pair[0].id,
      recipient_id: pair[0].id,
      body: "self",
    });
    check("self-addressed DM rejected by constraint", selfDm.status >= 400, `HTTP ${selfDm.status}`);

    if (dmId) await del(`direct_messages?id=eq.${dmId}`, SVC);
    const after = await get("direct_messages?select=id", SVC);
    const now = Array.isArray(after.body) ? after.body.length : -1;
    check(
      "DM count back to baseline (only the canary removed)",
      now === baselineDms,
      `${now} row(s), baseline was ${baselineDms}`,
    );
  }
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
  const now = Array.isArray(body) ? body.length : -1;
  check(
    "lead count back to baseline (only the probe row removed)",
    now === baselineLeads,
    `${now} row(s), baseline was ${baselineLeads}`,
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
