# ═══════════════════════════════════════════════════════════
#   SecureScore Frontend — Next.js 14 (Docker)
#   Multi-stage build: deps → builder → runner
# ═══════════════════════════════════════════════════════════
#
# Build:
#   docker build -t securescore-frontend ./frontend
#
# Run:
#   docker run -p 3000:3000 \
#     -e NEXT_PUBLIC_BFF_URL=http://localhost:4000 \
#     securescore-frontend
# ═══════════════════════════════════════════════════════════

FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# ── Builder ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env (replaced at build, not runtime)
ARG NEXT_PUBLIC_BFF_URL=http://localhost:4000
ENV NEXT_PUBLIC_BFF_URL=$NEXT_PUBLIC_BFF_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Runner (minimal image) ───────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S securescore && adduser -S securescore -G securescore

# Copy only what Next.js needs to serve the production build
COPY --from=builder /app/public ./public
COPY --from=builder --chown=securescore:securescore /app/.next/standalone ./
COPY --from=builder --chown=securescore:securescore /app/.next/static ./.next/static

USER securescore

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 127.0.0.1 not localhost: the standalone server binds IPv4, but localhost can
# resolve to IPv6 ::1 first, making the healthcheck fail while the app is fine.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
