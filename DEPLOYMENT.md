# Self-hosting the Quinta Lead Hub

Everything an ops engineer needs to run this app on Quinta infrastructure
instead of Vercel. Written to be handed over as-is.

**Repository:** `https://git.gotogo.im/scm/am/quinta-leads-hub.git`, branch
`preprod`. That is the source of truth. A GitHub copy exists only as a temporary
mirror feeding the current Vercel deployment.

Verified against the sign-in release on 2026-10-21.

---

## 1. What this is

A Next.js web app with a Supabase Postgres backend. Internal tool: sales and
consultants pass leads to each other, chat, and read company news.

**It contains no Vercel-specific code.** No `@vercel/*` packages, no `VERCEL_*`
environment variables. It is a stock Next.js server, so it runs anywhere Node
runs. Moving off Vercel needs no code changes.

## 2. Tech stack

| Layer | Choice | Version |
| --- | --- | --- |
| Runtime | Node.js | **≥ 20.9** (`engines`). CI builds on 22; use 22 LTS. |
| Framework | Next.js, App Router, Turbopack | 16.4.0 |
| UI | React | 19.2.8 |
| Language | TypeScript, `strict` | 5.x |
| Styling | Tailwind CSS | 4.x |
| Database | Supabase Postgres | managed, `eu-central-1` |
| Database client | `@supabase/supabase-js`, server-side only | 2.112.4 |
| Sign-in | Own sessions + scrypt (node:crypto); no auth library | — |
| Validation | zod | 4.5.4 |
| Markdown (news) | react-markdown + remark-gfm | 10.1.0 / 4.0.1 |

Production dependencies are only: `next`, `react`, `react-dom`,
`@supabase/supabase-js`, `zod`, `react-markdown`, `remark-gfm`, `server-only`.
No native modules beyond the optional `sharp` that Next uses for image
optimisation.

**Not used:** Supabase Storage, Supabase Auth, Supabase Realtime. Sign-in is the
app's own (accounts and sessions live in Postgres tables, see §6), there is no
file upload, and chat polls the app rather than holding a WebSocket.

## 3. Build and run

```bash
npm ci
npm run build        # next build
npm start            # next start, listens on $PORT (default 3000)
```

The server listens on `PORT`. There is no `basePath`, so **it must be served at
the root of a hostname** (`hub.quinta.im`), not under a path
(`quinta.im/hub`). Serving it on a subpath requires setting `basePath` in
`next.config.ts` and rebuilding.

### Build-time vs runtime variables

Since sign-in, **every variable is read at runtime**; none is compiled into the
browser bundle. The browser talks only to this app. So the artefact can be built
once and configured per environment at start.

(Older builds inlined `NEXT_PUBLIC_SUPABASE_*` at build time. If the Bamboo plan
still passes the publishable key as a build variable, that is now harmless but
unnecessary.)

### Footprint

| Item | Size |
| --- | --- |
| `.next` runtime artefacts | ~109 MB |
| `.next/cache` (build only, **not** needed at runtime) | ~184 MB — exclude from images |
| `.next/static` (assets the browser fetches) | ~1.2 MB |
| `node_modules` including dev | ~472 MB |

Cold start is fast: `Ready in ~170ms` on a laptop.

### If you are containerising

Add to `next.config.ts`:

```ts
const nextConfig: NextConfig = { output: "standalone" };
```

That emits `.next/standalone` with only the files and dependencies actually
needed, which is far smaller than shipping `node_modules`. It is not set today
because the app currently runs on Vercel, where it is unnecessary.

## 4. Environment variables

| Variable | Required | Secret? | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | **yes** | No | e.g. `https://uzhtjtzpqgsqhqzykyof.supabase.co`. Origin only — **no trailing path**. The old name `NEXT_PUBLIC_SUPABASE_URL` is still read if this is unset. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | **YES — highest sensitivity** | The secret key (`sb_secret_…`). Bypasses all RLS. Server only. Must never appear in a `NEXT_PUBLIC_*` variable or reach a browser. |
| `APP_ORIGIN` | recommended | No | The exact public origin, e.g. `https://hub.quinta.im`, no trailing slash. Every state-changing request must carry this `Origin`. When unset, the request's `Host` header is compared instead. |
| `NODE_ENV` | yes | No | Must be `production` — it also makes session cookies `Secure` and `__Host-` prefixed. |
| `AUTH_INSECURE_COOKIES` | no | No | **Leave unset.** `true` drops the `Secure` flag, for an internal deployment served over plain HTTP only — otherwise browsers discard the cookie and sign-in loops. |
| `ALLOW_DEV_STORE` | no | No | **Leave unset.** See the warning below. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | No | The publishable key. **The app no longer uses it.** Only `npm run verify:rls` needs it, to prove that key can read nothing. |

**Key format.** Since 16 Oct 2026 the project uses Supabase's new API keys: the
**secret** key (`sb_secret_…`) in `SUPABASE_SERVICE_ROLE_KEY`, and the
**publishable** key (`sb_publishable_…`) for the RLS check. The legacy JWT keys
are disabled. On Quinta's hosting the values live in Infisical (project
`quinta-leads-hub`, env `preprod`).

**HubSpot sync** adds two more, both server-only secrets in Infisical:

| Variable | Required | Notes |
| --- | --- | --- |
| `HUBSPOT_TOKEN` | for the sync | HubSpot private-app token. Unset = sync off; leads queue up and go once it is set. |
| `CRON_SECRET` | for the sweep | ≥ 32 random characters. Authenticates the scheduled sweep (§ HubSpot below). Unset = the route refuses every call. |

`HUBSPOT_API_BASE` exists for local testing against a mock and is ignored in
production.

> **Never set `ALLOW_DEV_STORE=true` in production.** It switches the app onto a
> JSON file on local disk instead of the database. Every instance would get its
> own copy, they would not share data, and a redeploy would wipe it. It exists
> only for local development without credentials. Left unset, a misconfigured
> deployment shows a readable setup screen instead of silently losing leads.

`.env.example` in the repo is the authoritative template.

## 5. Database

Managed Supabase project `uzhtjtzpqgsqhqzykyof`, region `eu-central-1`
(Frankfurt) — chosen for GDPR, since the app stores named prospect contact
details.

### Migrations

Apply in order via the Supabase SQL editor, or `psql` if you have the connection
string. They are plain SQL, in `supabase/migrations/`:

```
0001_init.sql                        9 tables, RLS, indexes, Realtime publication
0002_seed_channels.sql               the three chat channels
0003_people_email_optional.sql       email became optional
0004_direct_messages_and_mentions.sql
0005_notifications.sql
0006_lead_assigned_notification.sql  run on its own; see the file header
0007_auth.sql                        sign-in tables + admin functions (additive)
0008_lockdown.sql                    drops the last anon policies — see below
0009_hubspot_sync.sql                HubSpot sync state on leads + queue functions (additive)
0010_hubspot_deals.sql               HubSpot Deal id/outcome + functions (additive)
```

A fresh environment needs all ten, in order. After the Deal-aware code is live
on every deployment, queue leads that were synced before Deals existed, once:

```sql
select public.hubspot_queue_missing_deals();
``` **0008 must only be applied once
every running copy of the app has the sign-in release**: older copies read chat
through the publishable key, and 0008 is what stops that.

Tables: `people`, `leads`, `lead_events`, `lead_comments`, `channels`,
`messages`, `direct_messages`, `notifications`, `news`, `person_credentials`,
`sessions`, `login_throttle`, `admin_audit`.

### First admin

After 0007, nobody can sign in until an admin has a password. From a checkout
with the production variables in `.env.local` (or the environment):

```bash
npm run bootstrap-admin -- --email ahk@quinta.im --username akram.hkiri
```

It prompts for the password twice, hidden, and refuses once anyone has a sign-in.
After that, admins create and reset everyone else under **Manage users** in the
app. `--force` is the break-glass path if the only admin is locked out.

### Should you self-host Supabase too?

**Recommendation: keep the managed Supabase project.**

The app uses PostgREST (through `supabase-js`) and a handful of Postgres
functions — no Realtime, Auth or Storage any more. Self-hosting Supabase means
running Postgres *plus* PostgREST *plus* the gateway; plain Postgres alone is not
a drop-in, because the data layer speaks PostgREST.

If policy requires it to be in-house, that is a real piece of work and should be
scoped separately. The data is already in the EU.

## 6. Security model — read before configuring the proxy

**Everyone signs in with a username and password. Only admins create users,
set or reset sign-ins, and delete users.**

- **Sessions** are rows in `sessions`. The cookie (`__Host-leadhub_session`,
  `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`) carries a random 256-bit token;
  the table stores only its SHA-256. Every request re-checks it. Sessions end
  after **2 h idle** or **12 h** in total, and immediately on sign-out, password
  reset, role change or deletion. No sticky sessions or session store needed.
- **Passwords** are scrypt-hashed (N=2¹⁵, r=8, p=3; ~200 ms and 32 MiB per
  verify, at most 4 concurrent per instance). Minimum 15 characters.
- **Login throttling** is in Postgres, so it holds across instances: per
  address, per account-and-address, and a looser per-account backstop. Every
  failure returns the same response.
- **Admin changes** require the admin's password within the last 10 minutes,
  run as single Postgres transactions that never leave zero admins, and are
  written to `admin_audit`.
- **CSRF**: every state-changing request must be same-origin by Fetch Metadata,
  carry a matching `Origin` (see `APP_ORIGIN`), and be JSON.
- `SUPABASE_SERVICE_ROLE_KEY` is the one real secret. The browser holds **no**
  Supabase key; after 0008 the publishable key reads nothing at all.
- Verify after any deploy or migration:

  ```bash
  npm run verify:rls
  ```

  Assertions against the live project: canary rows in leads, DMs,
  notifications, credentials and sessions stay invisible to the publishable key,
  and none of the admin functions can be called with it. Prints no secrets.

- The site sends `noindex` and a blanket `Disallow` in `robots.txt`.

### Reverse proxy requirements

- **The app must only be reachable through the proxy.** Login throttling keys on
  the client address from the **last** `X-Forwarded-For` entry, i.e. the one the
  proxy appends. If the app port is reachable directly, a client can invent that
  header and spread guesses over fake addresses (the per-account backstop still
  bounds them).
- The proxy must **append** to `X-Forwarded-For` (nginx:
  `$proxy_add_x_forwarded_for`), and terminate TLS. Set HSTS there.
- Pass the `Host` header through unchanged, or set `APP_ORIGIN`.

### Still worth doing

Behind Quinta's own infrastructure you can also **put it behind the VPN or an
SSO reverse proxy**. That is defence in depth on top of the app's own sign-in,
and needs no application change.

## 7. Networking and firewall

| Direction | Endpoint | Protocol | Why |
| --- | --- | --- | --- |
| Users → app | your hostname | HTTPS 443 | serving the app |
| App server → Supabase | `*.supabase.co` | HTTPS 443 | all reads and writes under the service-role key |
Users' browsers need **nothing** beyond the app's own hostname: chat polls the
app every few seconds instead of opening a WebSocket to Supabase. No WebSocket
support is needed anywhere, so a plain HTTP reverse proxy is fine.

## 7b. HubSpot sync

Every new lead is created in HubSpot as a **Lead** (pipeline "Lead pipeline",
stage Sales Qualified Lead) **and a Deal** (pipeline "Pipeline des ventes",
stage Target), with its contact (matched by email), its company (matched by
website domain) and a note. Owner changes follow both — the app is the
authority for ownership. The Deal's stage changes only on the app's outcome:
won → Contract signed, lost → Contract lost; the stages in between are sales'. The
queue lives in Postgres (migration 0009), so nothing is lost if a pod dies
mid-sync: a lease expires and another worker picks the lead up.

The worker runs right after each lead change and, throttled, during normal
traffic. **Also schedule a sweep**, so retries happen even when nobody is using
the app — a Kubernetes CronJob every 5 minutes:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://quinta-leadhub.quinta.im/api/cron/hubspot
```

(On Vercel, `vercel.json` schedules the same call daily, which is all the Hobby
plan allows; traffic covers the rest.)

Outbound: the app server needs HTTPS to `api.hubapi.com`.

Before switching it on: `npm run hubspot:preflight` (read-only) checks the
token, the Lead properties, the pipeline and stages, and which roster people
are HubSpot owners.

## 8. Health checks

```
GET /api/health
```

| Response | Status | Meaning |
| --- | --- | --- |
| `{"status":"ok","store":"supabase"}` | 200 | Instance can serve requests |
| `{"status":"degraded","store":"supabase"}` | 503 | Cannot reach the database |
| `{"status":"unconfigured","store":"unconfigured"}` | 503 | Environment variables missing |

Cheap by design — it reads three rows — and safe to poll every few seconds. It
returns no versions, hostnames, keys or error text.

Use it for both liveness and readiness. `GET /robots.txt` is a static
alternative if you want a check that does not touch the database at all.

## 9. Scaling and known limitations

**Login throttling is shared** (Postgres) and holds across instances.

**Write-endpoint rate limiting is per-instance and in-memory**
(`lib/rate-limit.ts`). Every write now needs a session, so this only caps what
one account can do. Behind a load balancer with N instances the effective limit
is N times the intended one. Options, in order of preference:

1. Run a single instance — this is an internal tool for ~68 people.
2. Accept the weaker limit.
3. Move the limiter to a shared store (Redis) — a small, well-isolated change.

**Sessions:** in Postgres (`sessions`). No sticky sessions, no session store.
Expired rows are cleaned up on each sign-in; no scheduled job needed.

**Uploads:** none.

**Scheduled jobs:** none.

**Logs:** stdout/stderr. Notification write failures log
`notification insert failed` and are deliberately non-fatal.

## 10. Deploy checklist

1. Node 22 LTS available.
2. Migrations 0001–0007 applied, in order; 0008 once no old copy is running.
3. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` injected at runtime from
   Infisical. `APP_ORIGIN` set to the public origin.
4. `ALLOW_DEV_STORE` and `AUTH_INSECURE_COOKIES` unset. `NODE_ENV=production`.
5. Served at a hostname root over HTTPS, reachable **only** through the proxy,
   which appends `X-Forwarded-For`.
6. First admin bootstrapped (`npm run bootstrap-admin`, see §5).
7. `GET /api/health` returns 200, and `/` redirects to `/login` when signed out.
8. `npm run verify:rls` passes.
9. `npm run check` passes. It runs typecheck, lint, build, a check that the
    service-role key is absent from the whole build output, and a production
    dependency audit — the natural CI step. It needs no secrets: on a runner
    with no key configured it builds with a sentinel value and searches for
    that, so the leak check is real either way. Run it again after any change
    to how environment variables are injected.

## 11. What to ask us for

- The three Supabase values, from a secret channel — not email or chat.
- Confirmation of whether the service-role key has been rotated. It should be
  rotated before handover regardless.
- The HubSpot private-app token and the cron secret, through Infisical.
