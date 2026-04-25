import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          globals: true,
          include: ["src/server/**/*.test.ts", "src/shared/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          globals: true,
          include: ["src/client/**/*.test.ts", "src/client/**/*.test.tsx"]
        }
      }
    ],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
