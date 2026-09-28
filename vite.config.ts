import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorEsmPlugin from "vite-plugin-monaco-editor-esm";

export default defineConfig({
  root: ".",
  base: "/",
  plugins: [react(), monacoEditorEsmPlugin()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },

  server: {
    port: 3000,
    proxy: {
      // Public
      "/healthz": { target: "http://localhost:8080", changeOrigin: true },
      "/game": { target: "http://localhost:8080", changeOrigin: true },
      "/theme": { target: "http://localhost:8080", changeOrigin: true },

      // Auth. Each key is a prefix, so "/password" also carries the reset
      // endpoints under it.
      "/login": { target: "http://localhost:8080", changeOrigin: true },
      "/register": { target: "http://localhost:8080", changeOrigin: true },
      "/auth": { target: "http://localhost:8080", changeOrigin: true },
      "/password": { target: "http://localhost:8080", changeOrigin: true },
      "/email": { target: "http://localhost:8080", changeOrigin: true },

      // Content. This list is an allowlist, not a prefix match: an endpoint the
      // client calls but nobody adds here is served Vite's index.html in dev
      // and only works in a production build, where both sides share an origin.
      "/items": { target: "http://localhost:8080", changeOrigin: true },
      "/npcs": { target: "http://localhost:8080", changeOrigin: true },
      "/shops": { target: "http://localhost:8080", changeOrigin: true },
      "/shop": { target: "http://localhost:8080", changeOrigin: true },
      "/maps": { target: "http://localhost:8080", changeOrigin: true },
      "/loot": { target: "http://localhost:8080", changeOrigin: true },
      "/spells": { target: "http://localhost:8080", changeOrigin: true },
      "/arrows": { target: "http://localhost:8080", changeOrigin: true },
      "/behaviors": { target: "http://localhost:8080", changeOrigin: true },
      "/dialogs": { target: "http://localhost:8080", changeOrigin: true },
      "/quests": { target: "http://localhost:8080", changeOrigin: true },
      "/recipes": { target: "http://localhost:8080", changeOrigin: true },

      // Editors
      "/saveMap": { target: "http://localhost:8080", changeOrigin: true },
      "/openMapEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openModEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openContentEditor": { target: "http://localhost:8080", changeOrigin: true },

      // Players
      "/players": { target: "http://localhost:8080", changeOrigin: true },

      // Moderation
      "/mod": { target: "http://localhost:8080", changeOrigin: true },

      // Admin dashboard API (session/login/console/scripts). Regex so the
      // literal "/admin" page itself still falls through to Vite's SPA
      // index, only "/admin/<something>" API calls are proxied.
      "^/admin/.+": { target: "http://localhost:8080", changeOrigin: true },

      // Assets
      "/assets": { target: "http://localhost:8080", changeOrigin: true },
      "/audio": { target: "http://localhost:8080", changeOrigin: true },

      // Client error reports
      "/client-error": { target: "http://localhost:8080", changeOrigin: true },

      // WebSocket
      "/ws": { target: "ws://localhost:8080", ws: true, changeOrigin: true },
    },
  },
});
