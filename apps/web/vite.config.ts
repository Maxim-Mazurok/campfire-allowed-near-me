import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const webPort = parsePort(process.env.WEB_PORT, 5173);
const previewPort = parsePort(process.env.WEB_PREVIEW_PORT, 4173);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8787";
const strictPort = process.env.VITE_STRICT_PORT === "1";

export default defineConfig({
  root: "apps/web",
  plugins: [react({})],
  server: {
    port: webPort,
    strictPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: previewPort
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true
  }
});
