# Quinta Lead Hub

Internal web app for Quinta. Sales and consultants pass leads to each other,
discuss them, and read company news — one URL, no app to install.

Inspired in shape by [Wimmov](https://www.wimmov.com/), which does this for
external referral networks. This is the internal, web-only equivalent, and it
runs on Quinta's own monochrome brand rather than Wimmov's blue.

## What it does

| Area | Purpose |
| --- | --- |
| **Lead board** | Bidirectional. Sales post leads for consultants, consultants post leads for sales. Each lead carries a requester, an assignee and a status. |
| **Chat** | Channel-based and live-updating, plus a discussion thread on every lead. |
| **News** | Quinta announcements feed. |
| **HubSpot** | Accepted leads are pushed to HubSpot as contact + company + deal. |

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS 4 ·
Supabase Postgres + Realtime · Vercel · HubSpot private app

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

The Supabase variables may be left blank to start. With no credentials the app
falls back to a file-backed store in `.data/`, so the whole UI is runnable
locally. That fallback refuses to start when `NODE_ENV=production`.

Open http://localhost:3000.

## Security model — read this

**There is no sign-in.** Anyone with the URL can use the app. Identity is a name
picked from a roster and stored in `localStorage`; it labels who did what, and is
never trusted for authorisation.

That single decision drives the rest of the design:

- The `service_role` key and the HubSpot token are **server-only**. All writes go
  through `app/api/*` route handlers.
- Supabase runs with **RLS on and no permissive write policies**. The browser's
  anon key can read `messages` and `channels` and nothing else.
- The site sends `noindex` and a blanket `Disallow` in `robots.txt`, so the URL
  never surfaces in search.
- Record-creating endpoints are rate limited, because an open endpoint that
  writes to HubSpot is an abuse surface.

### Worth knowing

An open URL holds prospect names, emails and phone numbers — third-party
personal data, reachable by anyone who learns the URL. That is a GDPR exposure.
If you want a floor under it without introducing accounts, set `ACCESS_CODE` in
the environment: one shared word, prompted once, remembered 30 days. Blank means
fully open, which is the current default and a deliberate choice.

## Code review

Every change lands through a pull request reviewed by **Codex**, with
[`AGENTS.md`](./AGENTS.md) supplying the repo-specific review rules — secret
handling, RLS, PII in logs, and brand constraints.

One-time setup: at `chatgpt.com/codex/settings/code-review`, enable Code review
for this repository and turn on **Automatic reviews**. `@codex review` on a pull
request triggers a run on demand.

GitHub Actions covers what Codex should not spend attention on: typecheck, lint,
build, `npm audit`, a gitleaks history scan, CodeQL with `security-extended`, and
an assertion that no server secret appears in the client bundle.

## Brand

Black `#000000` and white `#FFFFFF`, Caladea Bold for headings, Lato for body.
Colour appears **only** to signal status:

| State | Hex |
| --- | --- |
| Won | `#2E7D32` |
| Watch | `#EF6C00` |
| Lost | `#C62828` |
| Info | `#1565C0` |
| Pending | `#616161` |

Tokens live in [`app/globals.css`](./app/globals.css). Raw hex values and stock
Tailwind palette classes are review findings.
