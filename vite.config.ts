import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.AGENT_FLEET_API_PORT ?? process.env.AGENT_FLEET_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  build: {
    outDir: "dist/client"
  }
});
