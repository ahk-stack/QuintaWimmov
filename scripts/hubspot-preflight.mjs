/**
 * `npm run hubspot:preflight` — READ-ONLY checks against the real HubSpot
 * portal before the sync is switched on. Writes nothing to HubSpot.
 *
 * Confirms the token works and has the read scopes, that the Lead properties,
 * pipeline and stages the code uses exist, that the custom `quinta_lead_hub_id`
 * property is there, and how many roster people map to a HubSpot owner.
 *
 * Reads HUBSPOT_TOKEN (and the Supabase variables, for the roster) from the
 * environment / .env.local. Never prints the token or any contact data.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

const TOKEN = process.env.HUBSPOT_TOKEN?.trim();
if (!TOKEN) {
  console.error("hubspot-preflight: HUBSPOT_TOKEN is not set (.env.local or environment).");
  process.exit(1);
}

const API = "https://api.hubapi.com";
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL <<<"}  ${label}${detail ? `  (${detail})` : ""}`);
};

async function hs(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

const searchOne = (type) =>
  hs("POST", `/crm/v3/objects/${type}/search`, { limit: 1, properties: ["hs_object_id"] });

console.log("1. Token and read scopes");
for (const type of ["contacts", "companies", "leads", "notes"]) {
  const { status } = await searchOne(type);
  check(`can read ${type}`, status === 200, `HTTP ${status}`);
}
{
  const { status } = await hs("GET", "/crm/v3/owners?limit=1");
  check("can read owners", status === 200, `HTTP ${status}`);
}

console.log("\n2. Lead properties used by the sync");
for (const name of ["hs_lead_name", "hs_pipeline", "hs_pipeline_stage", "hubspot_owner_id"]) {
  const { status } = await hs("GET", `/crm/v3/properties/leads/${name}`);
  check(name, status === 200, `HTTP ${status}`);
}
{
  const { status, json } = await hs("GET", "/crm/v3/properties/leads/quinta_lead_hub_id");
  check("custom property quinta_lead_hub_id exists", status === 200, `HTTP ${status}`);
  if (status === 200) {
    check("  it is single-line text", json?.type === "string" && json?.fieldType === "text", `${json?.type}/${json?.fieldType}`);
    // Required: it is what stops a retried create from making a second Lead.
    check("  it requires unique values", json?.hasUniqueValue === true, json?.hasUniqueValue ? "yes" : "no");
  }
}

console.log("\n3. Lead pipeline and stages");
{
  const { status, json } = await hs("GET", "/crm/v3/pipelines/leads");
  check("pipelines readable", status === 200, `HTTP ${status}`);
  const pipeline = json?.results?.find((p) => p.id === "lead-pipeline-id");
  check("pipeline lead-pipeline-id exists", Boolean(pipeline));
  const stages = new Map((pipeline?.stages ?? []).map((s) => [s.id, s.label]));
  for (const [id, meaning] of [
    ["connected-stage-id", "start / in progress"],
    ["qualified-stage-id", "won"],
    ["unqualified-stage-id", "lost"],
  ]) {
    check(`stage ${id} (${meaning})`, stages.has(id), stages.get(id) ?? "missing");
  }
}

console.log("\n4. Roster → HubSpot owners (by email)");
{
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("  SKIP  no Supabase variables; roster not checked");
  } else {
    const r = await fetch(`${url}/rest/v1/people?select=name,email&active=eq.true&order=name`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const people = r.ok ? await r.json() : [];
    const owners = [];
    let after;
    do {
      const page = await hs("GET", `/crm/v3/owners?limit=100&archived=false${after ? `&after=${after}` : ""}`);
      owners.push(...(page.json?.results ?? []));
      after = page.json?.paging?.next?.after;
    } while (after);
    const ownerEmails = new Set(owners.map((o) => String(o.email ?? "").toLowerCase()));
    const unmapped = people.filter((p) => !p.email || !ownerEmails.has(p.email.toLowerCase()));
    console.log(`  INFO  ${people.length - unmapped.length} of ${people.length} people are HubSpot owners.`);
    console.log("  INFO  Leads assigned to the others sync with no HubSpot owner, and the app says so.");
    if (unmapped.length) console.log(`  INFO  Not owners: ${unmapped.map((p) => p.name).join(", ")}`);
  }
}

console.log(`\n${failures === 0 ? "PREFLIGHT PASSED" : `${failures} CHECK(S) FAILED`}`);
console.log("Write scopes (create contacts/companies/leads/notes) are proven by the one test lead.");
process.exitCode = failures === 0 ? 0 : 1;
