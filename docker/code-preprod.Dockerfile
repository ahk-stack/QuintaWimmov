# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Quinta Leads Hub — preprod image
# Multi-stage, non-root, Next.js standalone output (see next.config.ts).
# Built/pushed by CI as: qtk8s.azurecr.io/quinta-leads-hub_code:<git-sha>
#
#   docker build -f docker/code-preprod.Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
#     -t qtk8s.azurecr.io/quinta-leads-hub_code:<git-sha> .
#
# NEXT_PUBLIC_* are inlined into the JS bundle at BUILD time: they are build
# args, and changing them needs a rebuild, not a restart. Both are public by
# design (the anon key is constrained by RLS).
# SUPABASE_SERVICE_ROLE_KEY is deliberately NOT a build arg: it is injected at
# runtime from Infisical and must never be baked into the image.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-bookworm-slim

############################
# Stage 1 — dependencies
############################
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Reproducible install from the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

############################
# Stage 2 — build
############################
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Fail here rather than ship a bundle that cannot reach Supabase: a build
# without these succeeds and only breaks at runtime. The URL must be the bare
# origin — the client appends /rest/v1 and /realtime/v1 itself.
RUN test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
      || { echo "build arg NEXT_PUBLIC_SUPABASE_ANON_KEY is required" >&2; exit 1; } \
    && printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | grep -Eq '^https://[^/]+$' \
      || { echo "build arg NEXT_PUBLIC_SUPABASE_URL must be https://<ref>.supabase.co (no path, no trailing slash)" >&2; exit 1; }

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############################
# Stage 3 — runtime
############################
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# tini = correct PID 1 (signal forwarding + zombie reaping).
# Dedicated unprivileged user/group.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs

# Standalone server + its traced node_modules. Static assets and public/ are
# not part of the standalone output and must be copied next to it.
# No node_modules from the build stage, no source, no .next/cache.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
