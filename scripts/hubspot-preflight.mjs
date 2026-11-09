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
for (const type of ["contacts", "companies", "leads", "deals", "notes"]) {
  const { status } = await searchOne(type);
  check(`can read ${type}`, status === 200, `HTTP ${status}`);
}
{
  const { status } = await hs("GET", "/crm/v3/owners?limit=1");
  check("can read owners", status === 200, `HTTP ${status}`);
}

{
  // Granted scopes, where HubSpot reports them for this kind of key.
  const info = await hs("POST", "/oauth/v2/private-apps/get/access-token-info", { tokenKey: TOKEN });
  const scopes = Array.isArray(info.json?.scopes) ? new Set(info.json.scopes) : null;
  if (!scopes) {
    console.log("  INFO  this key type does not report its scopes; write access is proven by the test lead");
  } else {
    for (const scope of [
      "crm.objects.contacts.write",
      "crm.objects.companies.write",
      "crm.objects.leads.write",
      "crm.objects.deals.write",
    ]) {
      check(`granted ${scope}`, scopes.has(scope));
    }
  }
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

console.log("\n2b. Deal properties used by the sync");
for (const name of ["dealname", "pipeline", "dealstage", "closedate", "hubspot_owner_id"]) {
  const { status } = await hs("GET", `/crm/v3/properties/deals/${name}`);
  check(name, status === 200, `HTTP ${status}`);
}
{
  const { status, json } = await hs("GET", "/crm/v3/properties/deals/quinta_lead_hub_id");
  check("custom deal property quinta_lead_hub_id exists", status === 200, `HTTP ${status}`);
  if (status === 200) {
    check("  it is single-line text", json?.type === "string" && json?.fieldType === "text", `${json?.type}/${json?.fieldType}`);
    check("  it requires unique values", json?.hasUniqueValue === true, json?.hasUniqueValue ? "yes" : "no");
  }
}
{
  const { status, json } = await hs("GET", "/crm/v3/pipelines/deals");
  const pipeline = json?.results?.find((p) => p.id === "default");
  check("deal pipeline 'default' (Pipeline des ventes)", status === 200 && Boolean(pipeline), pipeline?.label ?? `HTTP ${status}`);
  const stages = new Map((pipeline?.stages ?? []).filter((s) => !s.archived).map((s) => [s.id, s]));
  for (const [id, meaning] of [["qualifiedtobuy", "start"], ["closedwon", "won"], ["closedlost", "lost"]]) {
    check(`deal stage ${id} (${meaning})`, stages.has(id), stages.get(id)?.label ?? "missing");
  }
  check("closedwon is a won stage", stages.get("closedwon")?.metadata?.isClosed === "true" && Number(stages.get("closedwon")?.metadata?.probability) === 1);
  check("closedlost is a lost stage", stages.get("closedlost")?.metadata?.isClosed === "true" && Number(stages.get("closedlost")?.metadata?.probability) === 0);
}

console.log("\n2c. Association types (id and direction)");
for (const [from, to, id] of [["leads", "deals", 582], ["deals", "contacts", 3], ["deals", "companies", 5], ["notes", "deals", 214], ["notes", "leads", 855], ["leads", "contacts", 578], ["leads", "companies", 580]]) {
  const { status, json } = await hs("GET", `/crm/v4/associations/${from}/${to}/labels`);
  check(`${from} → ${to} type ${id}`, status === 200 && (json?.results ?? []).some((r) => r.typeId === id && r.category === "HUBSPOT_DEFINED"), `HTTP ${status}`);
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
console.log("Reads, schema and associations are checked above. Writes and portal-required properties are only proven by the test lead.");
process.exitCode = failures === 0 ? 0 : 1;
