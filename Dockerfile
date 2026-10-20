# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
# npm 11 traz tar >= 7.5.19 (CVE-2026-59873 no tar 6 do npm 10) — scan do Trivy no CD.
RUN npm install -g npm@11 && npm cache clean --force
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --chown=node:node --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=builder /app/node_modules/dotenv ./node_modules/dotenv
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
