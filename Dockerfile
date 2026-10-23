# Support Zone CRM — production image (used by Dokploy's "Dockerfile" build type).
# Needs Node 22.13+ for the built-in SQLite module.
FROM node:24-slim

ENV NODE_ENV=production \
    TZ=Asia/Dubai \
    PORT=3000 \
    DB_PATH=/app/data/crm.db

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The database lives in /app/data — mount a persistent volume there or every redeploy starts empty.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
