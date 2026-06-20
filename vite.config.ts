import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
      "/healthz": { target: "http://localhost:8080", changeOrigin: true },

      // Auth
      "/login": { target: "http://localhost:8080", changeOrigin: true },
      "/register": { target: "http://localhost:8080", changeOrigin: true },

      // Content
      "/items": { target: "http://localhost:8080", changeOrigin: true },
      "/npcs": { target: "http://localhost:8080", changeOrigin: true },
      "/shops": { target: "http://localhost:8080", changeOrigin: true },
      "/shop": { target: "http://localhost:8080", changeOrigin: true },
      "/maps": { target: "http://localhost:8080", changeOrigin: true },

      // Editors
      "/saveMap": { target: "http://localhost:8080", changeOrigin: true },
      "/openMapEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openModEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openContentEditor": { target: "http://localhost:8080", changeOrigin: true },

      // Players
      "/players": { target: "http://localhost:8080", changeOrigin: true },

      // Moderation
      "/mod": { target: "http://localhost:8080", changeOrigin: true },

      // Assets
      "/assets": { target: "http://localhost:8080", changeOrigin: true },

      // WebSocket
      "/ws": { target: "ws://localhost:8080", ws: true, changeOrigin: true },
    },
  },
});
