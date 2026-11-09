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
| **Chat** | Channels that update themselves, direct messages, @mentions, and a discussion thread on every lead. |
| **News** | Quinta announcements feed. |
| **Accounts** | Username and password sign-in. Only admins create users, set or reset sign-ins, and delete users. |
| **HubSpot** | Every new lead becomes a HubSpot **Lead** (with its contact, company and a note), starting as Sales Qualified Lead; owner and status changes follow it. One-way, app → HubSpot. |

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS 4 ·
Supabase Postgres · Vercel (for now) · HubSpot private app

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

Open http://localhost:3000/api/health once (it creates the seeded dev store),
then give the seeded admin a password:

```bash
npm run bootstrap-admin -- --email ahk@quinta.im --username akram.hkiri
```

It prompts for the password (hidden). With Supabase configured it writes to the
database instead of the dev store. It refuses once anyone has a sign-in, unless
run with `--force` — the documented recovery if the only admin is locked out.

## Hosting

**Source of truth: Bitbucket**, `git.gotogo.im/scm/am/quinta-leads-hub`, branch
`preprod`. Work goes in on a feature branch and merges into `preprod` by pull
request.

GitHub (`ahk-stack/QuintaWimmov`) is a **temporary mirror**: production still runs
on Vercel, which deploys from it, so it keeps receiving `preprod` as `main` until
Quinta's own hosting is live. After that it should be archived, not used for
new work.

[`DEPLOYMENT.md`](./DEPLOYMENT.md) is the self-hosting
handover: stack and versions, the environment variables, migration order,
firewall rules, health checks and known limitations. The app contains no
Vercel-specific code, so moving it needs no code changes.

## Security model — read this

**Everyone signs in with a username and password, and only admins manage
accounts.** Nobody creates their own account or changes their own password.

- **Sessions are server-side.** The cookie (`__Host-leadhub_session`, HttpOnly,
  Secure, SameSite=Lax) holds a random token; the database holds only its
  SHA-256. Sessions end after 2 hours idle or 12 hours in total, and are revoked
  immediately on sign-out, password reset, role change or deletion.
- **Who is acting always comes from the session.** No request body carries an
  actor id. Every page calls `requireUser()` and every route handler calls
  `authorize()`; `proxy.ts` only redirects for convenience.
- **Passwords** are hashed with scrypt, at least 15 characters. Failed sign-ins
  are throttled in the database, shared across instances, and every failure
  looks the same, so the form does not reveal which usernames exist.
- **Admin changes** need the admin's password re-entered within 10 minutes, run
  as single database transactions that can never leave zero admins, and are
  recorded in an audit log.
- **The browser holds no Supabase key.** Chat polls the app instead of using
  Supabase Realtime, and after migration 0008 the publishable key can read
  nothing at all — `npm run verify:rls` proves it.
- Cross-site requests are refused (Fetch Metadata + Origin + JSON only), and the
  site is `noindex` with a blanket `Disallow`.

Direct messages are visible in the app only to their two participants.
Database administrators can still read them, so they are not a place for
passwords or personal data.

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
npm run review       # reviews the current branch against preprod
```

`npm run review:uncommitted` reviews staged, unstaged and untracked changes
before you commit. Codex picks up `AGENTS.md` on its own.

### If the connector is approved later

At `chatgpt.com/codex/settings/code-review`, enable Code review for the
repository and turn on **Automatic reviews**, and every pull request is reviewed
without anyone running a command. `@codex review` as a PR comment triggers a run
on demand. Note that automatic reviews only fire on pull requests opened after
the setting is enabled.

### Checks

```bash
npm run check   # typecheck, lint, build, service-key bundle check, npm audit
```

Run it before opening a pull request. It is plain Node with no shell tools, so
whatever CI the platform team wires to Bitbucket can call it as-is, and it needs
no secrets: with no service-role key configured it builds with a sentinel value
and checks the bundle for that instead.

`.github/workflows/` still runs on the GitHub mirror — those workflows add a
gitleaks history scan and CodeQL `security-extended` on top. They do not run on
Bitbucket. Until Bitbucket has CI of its own, those two exist only on the mirror,
and should be ported (or replaced) when the mirror is retired.

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
