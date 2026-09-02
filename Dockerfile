# --- Build stage: compile client (vite) and server (tsc) ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.* index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- Runtime stage: production deps only ---
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# game.json, scripts/ and assets/ are provided at runtime via bind mounts
# (see docker-compose.yml) so creators edit them without rebuilding the image.
USER node
EXPOSE 8080
# --enable-source-maps: the build ships .js.map files, so without it every
# stack in production points at compiled JavaScript nobody wrote.
CMD ["node", "--enable-source-maps", "dist/server/server.js"]
