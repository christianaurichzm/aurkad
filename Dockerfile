# --- Build stage: compile client (vite) and server (tsc) ---
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
# The build needs the dev tools, not the MongoDB binary mongodb-memory-server
# downloads on install for the test suite.
RUN MONGOMS_DISABLE_POSTINSTALL=1 npm ci

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

# Read from disk at runtime rather than compiled in: the official modules,
# the game new-game copies, and the scripting API's declarations that game
# scripts are type-checked against.
COPY modules ./modules
COPY templates ./templates
COPY scripts/global.d.ts scripts/tsconfig.json ./scripts/
COPY compose-entrypoint.sh ./

# The game itself is a bind mount (one folder with GAME_DIR pointing at it,
# compose.game.yml), so creators edit it without rebuilding the image.
USER node
EXPOSE 8080
# --enable-source-maps: the build ships .js.map files, so without it every
# stack in production points at compiled JavaScript nobody wrote.
CMD ["node", "--enable-source-maps", "dist/server/server.js"]
