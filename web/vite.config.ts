/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site from /brazil-fixed-income-lab/
export default defineConfig({
  base: process.env.BFIL_BASE ?? "/brazil-fixed-income-lab/",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender")) return "echarts";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
