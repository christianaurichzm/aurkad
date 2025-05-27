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
      "/login": { target: "http://localhost:8080", changeOrigin: true },
      "/items": { target: "http://localhost:8080", changeOrigin: true },
      "/npcs": { target: "http://localhost:8080", changeOrigin: true },
      "/shops": { target: "http://localhost:8080", changeOrigin: true },
      "/saveMap": { target: "http://localhost:8080", changeOrigin: true },
      "/openMapEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openModEditor": { target: "http://localhost:8080", changeOrigin: true },
      "/openContentEditor": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/assets": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true, changeOrigin: true },
    },
  },
});
