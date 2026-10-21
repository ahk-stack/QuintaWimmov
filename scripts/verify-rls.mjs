/**
 * Verifies the deployed schema and, more importantly, that the publishable
 * (anon) key cannot read, write or call anything. Run against the live project.
 *
 *   npm run verify:rls                  after migration 0008 (the normal case)
 *   npm run verify:rls -- --pre-0008    between 0007 and 0008, while the old
 *                                       chat policies still exist
 *
 * Reads credentials from .env.local and never prints them.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_BASE = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const PRE_LOCKDOWN = process.argv.includes("--pre-0008");

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
  "notifications",
  "news",
  "person_credentials",
  "sessions",
  "login_throttle",
  "admin_audit",
];

const pass = (b) => (b ? "PASS" : "FAIL <<<");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${pass(ok)}  ${label}${detail ? `  (${detail})` : ""}`);
};

console.log(`1. All ${TABLES.length} tables exist (service_role)`);
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

if (PRE_LOCKDOWN) {
  console.log("\n3. (pre-0008) anon can still read the two tables the old Realtime chat used");
  for (const t of ["channels", "messages"]) {
    const { status, body } = await get(`${t}?select=id`, ANON);
    check(`anon reads ${t}`, status === 200 && Array.isArray(body), `HTTP ${status}`);
  }
} else {
  console.log("\n3. anon reads NOTHING from chat (0008 removed the last two anon policies)");
  for (const t of ["channels", "messages"]) {
    const { status, body } = await get(`${t}?select=*`, ANON);
    const rows = Array.isArray(body) ? body.length : -1;
    check(`anon reads 0 from ${t}`, rows === 0, `${rows} row(s), HTTP ${status}`);
  }
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

/*
 * A second probe: an admin by role but with NO sign-in. The admin functions
 * must refuse them as an actor even under the service key — the database's own
 * authorisation, independent of the app.
 */
const noLoginRes = await post("people", SVC, {
  name: "RLS Probe Without Login",
  email: `rls-probe-nologin-${Date.now()}@example.invalid`,
  role: "admin",
  initials: "RN",
});
const noLoginPersonId = Array.isArray(noLoginRes.body) ? noLoginRes.body[0]?.id : null;
check("second temp person created", Boolean(noLoginPersonId), `HTTP ${noLoginRes.status}`);

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
for (const t of ["people", "lead_events", "lead_comments", "news", "direct_messages", "notifications"]) {
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

console.log("\n6c. THE NOTIFICATION BOUNDARY: previews quote message text, so anon must see none");
{
  const CANARY = `notif-canary-${Date.now()}-do-not-leak`;
  const baselineNotifs = await (async () => {
    const { body } = await get("notifications?select=id", SVC);
    return Array.isArray(body) ? body.length : -1;
  })();

  const two = await get("people?select=id&limit=2", SVC);
  const pair = Array.isArray(two.body) ? two.body : [];

  if (pair.length < 2) {
    check("two people available to plant a notification", false, "roster too small");
  } else {
    const planted = await post("notifications", SVC, {
      person_id: pair[0].id,
      kind: "direct_message",
      actor_id: pair[1].id,
      source_id: pair[1].id,
      href: `/chat/direct/${pair[1].id}`,
      preview: CANARY,
    });
    const notifId = Array.isArray(planted.body) ? planted.body[0]?.id : null;
    check("notification planted with service_role", Boolean(notifId), `HTTP ${planted.status}`);

    const svcView = await get("notifications?select=preview", SVC);
    check("service_role can read it", JSON.stringify(svcView.body ?? "").includes(CANARY));

    const anonView = await get("notifications?select=*", ANON);
    const rows = Array.isArray(anonView.body) ? anonView.body.length : -1;
    check("anon sees ZERO notifications", rows === 0, `${rows} row(s)`);
    check(
      "preview text absent from the anon response",
      !JSON.stringify(anonView.body ?? "").includes(CANARY),
    );

    const anonWrite = await post("notifications", ANON, {
      person_id: pair[0].id,
      kind: "mention",
      source_id: pair[1].id,
      href: "/chat/general",
    });
    check("anon INSERT into notifications refused", anonWrite.status >= 400, `HTTP ${anonWrite.status}`);

    if (notifId) await del(`notifications?id=eq.${notifId}`, SVC);
    const after = await get("notifications?select=id", SVC);
    const now = Array.isArray(after.body) ? after.body.length : -1;
    check(
      "notification count back to baseline",
      now === baselineNotifs,
      `${now} row(s), baseline was ${baselineNotifs}`,
    );
  }
}

console.log("\n6d. THE SIGN-IN BOUNDARY: hashes, sessions and admin functions are server-only");
{
  const HASH_CANARY = `scrypt$15$8$3$cHJvYmVwcm9iZXByb2Jl$${"Y".repeat(43)}`;
  const TOKEN_CANARY = "f".repeat(64);
  let sessionId = null;

  if (personId) {
    const cred = await post("person_credentials", SVC, {
      person_id: personId,
      username: `rls.probe.${Date.now() % 100000}`,
      password_hash: HASH_CANARY,
    });
    check("credential planted with service_role", cred.status < 300, `HTTP ${cred.status}`);
    const sess = await post("sessions", SVC, {
      token_hash: TOKEN_CANARY,
      person_id: personId,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    sessionId = Array.isArray(sess.body) ? sess.body[0]?.id : null;
    check("session planted with service_role", Boolean(sessionId), `HTTP ${sess.status}`);
  }

  for (const t of ["person_credentials", "sessions", "login_throttle", "admin_audit"]) {
    const { status, body } = await get(`${t}?select=*`, ANON);
    const rows = Array.isArray(body) ? body.length : -1;
    const text = JSON.stringify(body ?? "");
    check(
      `anon reads 0 from ${t}`,
      rows === 0 && !text.includes(HASH_CANARY) && !text.includes(TOKEN_CANARY),
      `${rows} row(s), HTTP ${status}`,
    );
  }

  const anonCred = await post("person_credentials", ANON, {
    person_id: personId,
    username: "anon.injected",
    password_hash: HASH_CANARY,
  });
  check("anon INSERT into person_credentials refused", anonCred.status >= 400, `HTTP ${anonCred.status}`);
  const anonSess = await post("sessions", ANON, {
    token_hash: "e".repeat(64),
    person_id: personId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  check("anon INSERT into sessions refused", anonSess.status >= 400, `HTTP ${anonSess.status}`);

  // PostgREST exposes every public function at /rpc; EXECUTE must be revoked.
  const rpcCalls = {
    admin_create_user: {
      p_actor: personId, p_name: "Anon Admin", p_email: null, p_role: "admin",
      p_territory: null, p_initials: "AA", p_username: "anon.admin", p_password_hash: HASH_CANARY,
    },
    admin_update_user: {
      p_actor: personId, p_target: personId, p_name: "x", p_email: null, p_role: "admin",
      p_territory: null, p_initials: "X",
    },
    admin_set_credentials: {
      p_actor: personId, p_target: personId, p_username: "anon.x", p_password_hash: HASH_CANARY,
    },
    admin_delete_user: { p_actor: personId, p_target: personId },
    bootstrap_set_credentials: { p_person: personId, p_username: "anon.boot", p_password_hash: HASH_CANARY, p_force: true },
    auth_throttle_clear: { p_keys: ["ip:" + "0".repeat(64)] },
    auth_throttle_hit: { p_keys: ["ip:" + "0".repeat(64)], p_window_seconds: 60 },
  };
  for (const [fn, args] of Object.entries(rpcCalls)) {
    const r = await post(`rpc/${fn}`, ANON, args);
    check(`anon cannot call ${fn}`, [401, 403, 404].includes(r.status), `HTTP ${r.status}`);
  }

  // The database itself refuses a non-admin actor, even under the service key.
  if (noLoginPersonId && personId) {
    const notAdmin = await post("rpc/admin_delete_user", SVC, { p_actor: noLoginPersonId, p_target: personId });
    check(
      "admin_delete_user refuses an actor who is not a signed-in admin",
      notAdmin.status >= 400 && JSON.stringify(notAdmin.body ?? "").includes("LH_NOT_ADMIN"),
      `HTTP ${notAdmin.status}`,
    );
  }

  // Throttle round trip on throwaway keys: counts per key, in order, atomically.
  const stamp = String(Date.now() % 100).padStart(2, "0");
  const keyA = `ip:${"ab".repeat(31)}${stamp}`;
  const keyB = `user:${"cd".repeat(31)}${stamp}`;
  const first = await post("rpc/auth_throttle_hit", SVC, { p_keys: [keyA, keyB], p_window_seconds: 60 });
  const second = await post("rpc/auth_throttle_hit", SVC, { p_keys: [keyB, keyA], p_window_seconds: 60 });
  check("throttle counts each attempt", JSON.stringify(first.body) === "[1,1]", `got ${JSON.stringify(first.body)}`);
  check("throttle returns counts in key order", JSON.stringify(second.body) === "[2,2]", `got ${JSON.stringify(second.body)}`);
  const burst = await Promise.all(
    Array.from({ length: 8 }, () => post("rpc/auth_throttle_hit", SVC, { p_keys: [keyA], p_window_seconds: 60 })),
  );
  const seen = burst.map((r) => (Array.isArray(r.body) ? r.body[0] : -1)).sort((a, b) => a - b);
  check("concurrent attempts each get their own count", JSON.stringify(seen) === "[3,4,5,6,7,8,9,10]", JSON.stringify(seen));
  await post("rpc/auth_throttle_clear", SVC, { p_keys: [keyA, keyB] });
  const cleared = await post("rpc/auth_throttle_hit", SVC, { p_keys: [keyA], p_window_seconds: 60 });
  check("throttle clears", JSON.stringify(cleared.body) === "[1]", `got ${JSON.stringify(cleared.body)}`);
  await post("rpc/auth_throttle_clear", SVC, { p_keys: [keyA] });

  if (sessionId) await del(`sessions?id=eq.${sessionId}`, SVC);
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
// Deleting the person cascades to the probe credential.
if (personId)
  check("person deleted", (await del(`people?id=eq.${personId}`, SVC)) < 300);
if (noLoginPersonId)
  check("second person deleted", (await del(`people?id=eq.${noLoginPersonId}`, SVC)) < 300);
{
  const { body } = await get("leads?select=id", SVC);
  const now = Array.isArray(body) ? body.length : -1;
  check(
    "lead count back to baseline (only the probe row removed)",
    now === baselineLeads,
    `${now} row(s), baseline was ${baselineLeads}`,
  );
}
{
  const { body } = await get(`person_credentials?select=person_id&person_id=eq.${personId}`, SVC);
  check("probe credential gone with its person", Array.isArray(body) && body.length === 0);
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
