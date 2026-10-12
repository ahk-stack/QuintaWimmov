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
locally.

That fallback refuses to run when `NODE_ENV=production`, because it keeps state
on local disk: on a serverless platform each instance gets its own copy and a
redeploy wipes it. A deployment with nothing configured shows a setup screen
naming the missing variables rather than erroring on every route. For a
throwaway demo with no database, `ALLOW_DEV_STORE=true` opts into the file store
knowingly — never use it for real leads.

Open http://localhost:3000.

## Hosting

Deployed on Vercel today. [`DEPLOYMENT.md`](./DEPLOYMENT.md) is the self-hosting
handover: stack and versions, the five environment variables, migration order,
firewall rules, health checks and known limitations. The app contains no
Vercel-specific code, so moving it needs no code changes.

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

Every change is reviewed by **Codex** against the repo-specific rules in
[`AGENTS.md`](./AGENTS.md) — secret handling, RLS, PII in logs, rate limiting and
the brand constraints.

### Reviewing locally (the path we use)

Codex Cloud's GitHub integration needs a ChatGPT workspace admin to approve the
GitHub connector, which we do not have. The CLI needs no such approval: it reads
the repository off local disk and signs in with your ChatGPT account, so it uses
the same Codex subscription without any GitHub link.

```bash
npm install -g @openai/codex
codex login          # "Sign in with ChatGPT"; no GitHub connector involved
npm run review       # reviews the current branch against main
```

`npm run review:uncommitted` reviews staged, unstaged and untracked changes
before you commit. Codex picks up `AGENTS.md` on its own.

### If the connector is approved later

At `chatgpt.com/codex/settings/code-review`, enable Code review for the
repository and turn on **Automatic reviews**, and every pull request is reviewed
without anyone running a command. `@codex review` as a PR comment triggers a run
on demand. Note that automatic reviews only fire on pull requests opened after
the setting is enabled.

### CI

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
