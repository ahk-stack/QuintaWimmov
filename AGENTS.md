<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Quinta Lead Hub

Internal web app for Quinta. Sales and consultants pass leads to each other,
discuss them in chat, and read company news. Next.js 16 (App Router, Turbopack),
Supabase Postgres. Source of truth is Bitbucket (`preprod`); GitHub is a temporary
mirror that Vercel deploys from until Quinta's own hosting is live.

## The one thing to understand first

**Everyone signs in; only admins manage accounts.** Sessions are server-side
(`lib/auth/session.ts`): the cookie holds a random token, the `sessions` table
holds its SHA-256, and every request re-checks it. Who is acting comes from the
session and nothing else. The browser is still hostile by assumption — a signed-in
user can send any request their browser can.

The browser holds no Supabase key at all. Everything it sees comes through this
app, under a checked session.

## Code Review Rules

### Authentication and authorisation
- Every route handler starts with `authorize(request, …)` from `lib/auth/guard.ts`
  (login and logout use `isSameOriginRequest` directly). A handler that reads or
  writes the store without it is a finding.
- Every page under `app/(hub)` calls `requireUser()` itself. The layout's check
  and `proxy.ts` are conveniences — a layout does not stop its pages rendering —
  so relying on either is a finding.
- The actor is always `auth.session.person.id`. A schema or handler that accepts
  an actor id (`createdBy`, `authorId`, `senderId`, `actorId`, …) from the body
  or query is a finding.
- Admin-only actions pass `{ admin: true }`; account changes also pass
  `{ reauth: true }`. Account changes go through the Postgres functions in
  migration 0007, which re-check the actor and the last-admin rule inside one
  transaction. Re-implementing those checks as separate queries is a finding.
- Login failures must stay indistinguishable: same status, same body, and one
  KDF — real or dummy — for every attempt that is not throttled. Throttled
  attempts skip the KDF by design (they are throttled by address, which reveals
  nothing about an account). An error that says "unknown user", "locked" or
  similar is a finding, as is a per-account counter that blocks the right
  password (that hands out a lockout of any known colleague).
- Throttle counts are taken atomically BEFORE the password is checked
  (`auth_throttle_hit`); check-then-record lets a burst slip past the limit.
- Changing a password ends every session of that person, the requester's own
  included.
- Never log or return passwords, password hashes, session tokens or their hashes.
- Authenticated responses carry `Cache-Control: private, no-store`.

### Secrets must never reach the client
- `SUPABASE_SERVICE_ROLE_KEY` and `HUBSPOT_TOKEN` are server-only. Flag any use
  inside a file carrying `"use client"`, any re-export that could be reached from
  one, and any attempt to expose either through a `NEXT_PUBLIC_*` variable.
- No `NEXT_PUBLIC_*` variable is needed by the app any more. Adding one, or any
  browser Supabase client, deserves scrutiny.

### All reads and writes go through the server
- Client components never talk to Supabase. Reads happen in server components
  or route handlers; mutations in `app/api/*/route.ts`.

### Database access control
- Every new table ships with RLS enabled and forced, **no** policies for `anon`
  or `authenticated`, and its grants to them revoked. A migration that creates a
  table without that is a finding.
- No `anon` policy of any kind is acceptable (0008 removed the last two).
- Every new function in `public` must `revoke execute … from public, anon,
  authenticated` and grant only `service_role`: PostgREST exposes it at `/rpc`.
- Run `npm run verify:rls` after any migration.

### Route-level guards do not cover metadata
- `generateMetadata` runs outside the route-group layout, so the `storeKind()`
  check in `app/(hub)/layout.tsx` does not protect it. Any `generateMetadata`
  that touches the store must bail out when `storeKind() === "unconfigured"`,
  or an unconfigured deployment 500s instead of showing the setup screen.
- A lookup by a malformed id must return "not found", not throw. Postgres
  answers `22P02` for a non-UUID in a uuid column; treating that as an error
  turns `/leads/<anything>` into a 500 on a URL anyone can reach.

### Contact data must not leak
- Lead contact fields (`contact_name`, `contact_email`, `contact_phone`) must not
  appear in `console.*` output, thrown error messages that reach the browser, or
  analytics payloads.
- API error responses return a generic message plus a status code. Detail stays
  server-side.

### Abuse limits
- Endpoints that create records — lead submission and HubSpot push especially —
  must be rate limited. A new unthrottled mutation endpoint is a finding.
- Login and password confirmation are throttled in the database
  (`lib/auth/login.ts`), not only in memory, so the limit holds across instances.
- HubSpot writes must search for an existing contact by email before creating
  one. A create-blind write duplicates CRM records.

### Brand rules are enforceable in code review
- Only these colours may appear: `#000000`, `#FFFFFF`, the neutral interface
  tokens in `app/globals.css`, and the five status tokens. A raw hex colour or a
  stock Tailwind palette class (`text-blue-500`, `bg-slate-100`, …) is a finding.
- Headings use `--font-heading` (Caladea), body uses `--font-sans` (Lato). No
  other families, no substitutions.

## Conventions

- TypeScript throughout, `strict` on. No `any` without a comment justifying it.
- Server components fetch data; client components handle interaction only.
- Data access is centralised in `lib/` — pages and route handlers should not
  build raw queries inline.
- Comments explain *why*, not *what*.

## Commands

```bash
npm run dev        # Turbopack dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```
