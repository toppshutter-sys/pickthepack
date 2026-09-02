# Runs the Pick the Pack server as a normal Node process — works on any
# container-based host (Fly.io, Railway, Render, Google Cloud Run,
# DigitalOcean App Platform, a plain VPS with Docker, etc.). The server
# reads its port from $PORT (falls back to 4000 locally) and binds to all
# interfaces by default, which is what every one of those platforms expects.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached across deploys that
# only change application code, not package.json.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

# Cloud platforms generally inject PORT themselves; 4000 is just the local
# fallback used by `npm start` / README instructions.
ENV PORT=4000
EXPOSE 4000

# Basic container-level healthcheck hitting the app's own /health route —
# most platforms also do their own HTTP health check against this route,
# but this makes `docker ps` / local testing show unhealthy containers too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "src/index.js"]
