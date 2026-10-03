# --- Build stage: compile client (vite) and server (tsc) ---
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.* index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- Runtime stage: production deps only ---
FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Read from disk at runtime rather than compiled in: the official modules, and
# the scripting API's declarations that game scripts are type-checked against.
COPY modules ./modules
COPY scripts/global.d.ts scripts/tsconfig.json ./scripts/

# The game itself is a bind mount - one folder with GAME_DIR pointing at it
# (compose.game.yml), or game.json, scripts/, assets/ and theme/ one by one
# (docker-compose.yml) - so creators edit it without rebuilding the image.
USER node
EXPOSE 8080
# --enable-source-maps: the build ships .js.map files, so without it every
# stack in production points at compiled JavaScript nobody wrote.
CMD ["node", "--enable-source-maps", "dist/server/server.js"]
