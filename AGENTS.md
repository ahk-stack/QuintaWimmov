<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Quinta Lead Hub

Internal web app for Quinta. Sales and consultants pass leads to each other,
discuss them in chat, and read company news. Next.js 16 (App Router, Turbopack),
Supabase Postgres, deployed on Vercel.

## The one thing to understand first

**There is no sign-in.** Anyone with the URL can use the app. Identity is a name
picked from a roster and kept in `localStorage` — it is an attribution label, not
an authentication claim, and must never be trusted for authorisation.

Everything in the security rules below follows from that. The browser is hostile
by assumption.

## Code Review Rules

### Secrets must never reach the client
- `SUPABASE_SERVICE_ROLE_KEY` and `HUBSPOT_TOKEN` are server-only. Flag any use
  inside a file carrying `"use client"`, any re-export that could be reached from
  one, and any attempt to expose either through a `NEXT_PUBLIC_*` variable.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` may be
  public. Any other `NEXT_PUBLIC_*` addition deserves scrutiny.

### All writes go through route handlers
- Client components must not write to Supabase directly. Mutations belong in
  `app/api/*/route.ts` (or a server action) using the server-side client.
- The client's only permitted direct Supabase use is the Realtime subscription
  for reading `messages`.

### Database access control
- Every new table ships with RLS enabled and **no** permissive write policy for
  `anon`. A migration that creates a table without an accompanying RLS statement
  is a finding.
- Read policies for `anon` are only acceptable on `messages` and `channels`, and
  only for `SELECT`.

### Contact data must not leak
- Lead contact fields (`contact_name`, `contact_email`, `contact_phone`) must not
  appear in `console.*` output, thrown error messages that reach the browser, or
  analytics payloads.
- API error responses return a generic message plus a status code. Detail stays
  server-side.

### The open URL is an abuse surface
- Endpoints that create records — lead submission and HubSpot push especially —
  must be rate limited. A new unthrottled mutation endpoint is a finding.
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
