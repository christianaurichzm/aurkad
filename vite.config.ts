import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The port the server resolves in dev (src/server/config.ts). Parsed rather
// than loaded because a production build runs this file too, and VITE_
// variables in process.env would reach its bundle.
const envFile = "./.env.development";
const port =
  process.env.PORT ||
  (existsSync(envFile) && parseEnv(readFileSync(envFile, "utf8")).PORT) ||
  8080;
const api = `http://localhost:${port}`;

export default defineConfig({
  root: ".",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },

  server: {
    port: 3000,
    proxy: {
      // Public
      "/healthz": { target: api, changeOrigin: true },
      "/game": { target: api, changeOrigin: true },
      "/theme": { target: api, changeOrigin: true },

      // Auth. Each key is a prefix, so "/password" also carries the reset
      // endpoints under it.
      "/login": { target: api, changeOrigin: true },
      "/register": { target: api, changeOrigin: true },
      "/auth": { target: api, changeOrigin: true },
      "/password": { target: api, changeOrigin: true },
      "/email": { target: api, changeOrigin: true },

      // Content. This list is an allowlist, not a prefix match: an endpoint the
      // client calls but nobody adds here is served Vite's index.html in dev
      // and only works in a production build, where both sides share an origin.
      "/items": { target: api, changeOrigin: true },
      "/npcs": { target: api, changeOrigin: true },
      "/shops": { target: api, changeOrigin: true },
      "/shop": { target: api, changeOrigin: true },
      "/maps": { target: api, changeOrigin: true },
      "/loot": { target: api, changeOrigin: true },
      "/spells": { target: api, changeOrigin: true },
      "/arrows": { target: api, changeOrigin: true },
      "/behaviors": { target: api, changeOrigin: true },
      "/dialogs": { target: api, changeOrigin: true },
      "/quests": { target: api, changeOrigin: true },
      "/recipes": { target: api, changeOrigin: true },

      // Editors
      "/saveMap": { target: api, changeOrigin: true },
      "/openMapEditor": { target: api, changeOrigin: true },
      "/openModEditor": { target: api, changeOrigin: true },
      "/openContentEditor": { target: api, changeOrigin: true },

      // Players
      "/players": { target: api, changeOrigin: true },

      // Moderation
      "/mod": { target: api, changeOrigin: true },

      // Admin dashboard API (session/login/console/scripts). Regex so the
      // literal "/admin" page itself still falls through to Vite's SPA
      // index, only "/admin/<something>" API calls are proxied.
      "^/admin/.+": { target: api, changeOrigin: true },

      // Assets
      "/assets": { target: api, changeOrigin: true },
      "/audio": { target: api, changeOrigin: true },

      // Client error reports
      "/client-error": { target: api, changeOrigin: true },

      // WebSocket
      "/ws": { target: `ws://localhost:${port}`, ws: true, changeOrigin: true },
    },
  },
});
