# Self-hosting the Quinta Lead Hub

Everything an ops engineer needs to run this app on Quinta infrastructure
instead of Vercel. Written to be handed over as-is.

Verified against commit `511c7af` on 2026-09-04.

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
| Framework | Next.js, App Router, Turbopack | 16.3.4 |
| UI | React | 19.2.8 |
| Language | TypeScript, `strict` | 5.x |
| Styling | Tailwind CSS | 4.x |
| Database | Supabase Postgres | managed, `eu-central-1` |
| Live chat | Supabase Realtime (WebSocket) | via `@supabase/supabase-js` 2.112.4 |
| Validation | zod | 4.5.4 |
| Markdown (news) | react-markdown + remark-gfm | 10.1.0 / 4.0.1 |

Production dependencies are only: `next`, `react`, `react-dom`,
`@supabase/supabase-js`, `zod`, `react-markdown`, `remark-gfm`, `server-only`.
No native modules beyond the optional `sharp` that Next uses for image
optimisation.

**Not yet used:** Supabase Storage, Supabase Auth. There is no file upload and
no sign-in, so nothing to provision for either.

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

### The one build gotcha that will bite you

`NEXT_PUBLIC_*` variables are **compiled into the JavaScript bundle at build
time**, not read at runtime. So:

- The two `NEXT_PUBLIC_SUPABASE_*` values must be present **during `npm run
  build`**, not only when the process starts.
- Changing them requires a **rebuild**, not a restart.
- A CI job that builds without them produces an artefact that cannot talk to the
  database, and it fails at runtime rather than at build time.

`SUPABASE_SERVICE_ROLE_KEY` is read at runtime and can be injected at start.

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

The app reads exactly five. Nothing else.

| Variable | Where | Secret? | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | build + runtime | No | e.g. `https://uzhtjtzpqgsqhqzykyof.supabase.co`. Origin only — **no trailing path**; the client appends `/rest/v1` itself. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build (inlined) | **No — public by design** | Ships in the browser bundle. Safe because RLS restricts it; see §6. |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime | **YES — highest sensitivity** | Bypasses all RLS. Server only. Must never appear in a `NEXT_PUBLIC_*` variable or reach a browser. |
| `NODE_ENV` | runtime | No | Must be `production`. |
| `ALLOW_DEV_STORE` | runtime | No | **Leave unset.** See the warning below. |

Phase 5 (HubSpot push, not yet built) will add `HUBSPOT_TOKEN`,
`HUBSPOT_PIPELINE_ID` and `HUBSPOT_DEAL_STAGE_ID`, all server-only secrets.

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
```

All six are **already applied** to the live project. A fresh environment needs
all six, in order.

Tables: `people`, `leads`, `lead_events`, `lead_comments`, `channels`,
`messages`, `direct_messages`, `notifications`, `news`.

### Should you self-host Supabase too?

**Recommendation: keep the managed Supabase project.**

The app depends on Supabase Realtime for live chat, not just Postgres.
Self-hosting means running Postgres *plus* PostgREST *plus* Realtime *plus* the
gateway, and Realtime is the fiddliest part. Plain Postgres is not a drop-in:
chat would need rewriting.

If policy requires it to be in-house, that is a real piece of work and should be
scoped separately. The data is already in the EU.

## 6. Security model — read before configuring the proxy

**This app has no sign-in.** Anyone who can reach the URL can use it, and
identity is a name picked from a dropdown. That was a deliberate product
decision, and everything below follows from it.

- `SUPABASE_SERVICE_ROLE_KEY` is the only real secret. It bypasses every
  database policy. It is what protects lead contact data, direct messages and
  notification previews.
- The anon key in the browser is public **on purpose**. Postgres RLS is what
  protects the data: exactly two policies exist, both `SELECT` for `anon`, on
  `channels` and `messages` only, because the browser's chat subscription needs
  them. Everything else — including `leads` — returns zero rows to that key.
- Verify this yourself after any deploy or migration:

  ```bash
  npm run verify:rls
  ```

  40 assertions against the live project, including planting a canary row and
  confirming the anon key cannot see it. It prints no secrets.

- The site sends `noindex` and a blanket `Disallow` in `robots.txt`.

### The opportunity self-hosting gives you

On Vercel this app is a public URL. Behind Quinta's own infrastructure you can
**put it behind the VPN or an SSO reverse proxy**, which is the proper fix for
the missing sign-in — and it needs no application change. If that is on the
table, it is the single biggest security improvement available here.

An in-app alternative exists but is weaker: an `ACCESS_CODE` shared passcode,
currently unimplemented in code and documented in `.env.example`.

## 7. Networking and firewall

| Direction | Endpoint | Protocol | Why |
| --- | --- | --- | --- |
| Users → app | your hostname | HTTPS 443 | serving the app |
| App server → Supabase | `*.supabase.co` | HTTPS 443 | all reads and writes under the service-role key |
| **Users' browsers → Supabase** | `*.supabase.co` | **HTTPS 443 + WSS 443** | **live chat** |

**The third row is the one that gets missed.** Live chat is a WebSocket from the
*user's browser* straight to Supabase — it does not pass through the app server.
If outbound WSS to `*.supabase.co` is blocked on the corporate network, the app
still works but chat silently stops updating; the UI shows "Offline" instead of
"Live".

The app server itself needs **no inbound WebSocket support**, so a plain HTTP
reverse proxy is fine.

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

**Rate limiting is per-instance and in-memory.** The write endpoints are
throttled by an in-process counter (`lib/rate-limit.ts`). Behind a load balancer
with N instances the effective limit is N times the intended one. It is
documented in the source. Options, in order of preference:

1. Run a single instance — this is an internal tool for ~68 people.
2. Accept the weaker limit.
3. Move the limiter to a shared store (Redis) — a small, well-isolated change.

**Sessions:** none. No sticky sessions needed, no session store. Identity lives
in a browser cookie and `localStorage`.

**Uploads:** none.

**Scheduled jobs:** none.

**Logs:** stdout/stderr. Notification write failures log
`notification insert failed` and are deliberately non-fatal.

## 10. Deploy checklist

1. Node 22 LTS available.
2. Six migrations applied, in order.
3. Both `NEXT_PUBLIC_SUPABASE_*` present **at build time**.
4. `SUPABASE_SERVICE_ROLE_KEY` injected at runtime, from your secret store.
5. `ALLOW_DEV_STORE` unset. `NODE_ENV=production`.
6. Served at a hostname root over HTTPS.
7. Outbound HTTPS + **WSS** to `*.supabase.co` permitted for user browsers.
8. `GET /api/health` returns 200.
9. `npm run verify:rls` passes.
10. Grep the built client assets for the service-role key and confirm it is
    absent — CI does this on every build, and it is worth repeating after any
    change to how environment variables are injected.

## 11. What to ask us for

- The three Supabase values, from a secret channel — not email or chat.
- Confirmation of whether the service-role key has been rotated. It should be
  rotated before handover regardless.
- The HubSpot credentials when Phase 5 lands.
