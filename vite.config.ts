import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devPort = Number(process.env.NORN_DEV_PORT ?? process.env.PORT ?? 1420);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: false,
  },
});
