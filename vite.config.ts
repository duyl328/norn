import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

const devPort = Number(process.env.NORN_DEV_PORT ?? process.env.PORT ?? 1420);

// 分包可视化：`pnpm analyze` 时产出 dist/stats.html，按模块/包看压缩后体积占比，定位首屏包里谁最重。
const analyzePlugins: PluginOption[] = process.env.ANALYZE
  ? [
      (await import("rollup-plugin-visualizer")).visualizer({
        filename: "dist/stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
      }) as PluginOption,
    ]
  : [];

export default defineConfig({
  plugins: [react(), ...analyzePlugins],
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
