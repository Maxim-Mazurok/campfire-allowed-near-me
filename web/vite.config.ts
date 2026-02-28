import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, searchForWorkspaceRoot } from "vite";
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
const strictPort = process.env.VITE_STRICT_PORT === "1";
const require = createRequire(__filename);

const resolveInstalledNodeModulesDir = () => {
  try {
    const vitePackageJsonPath = require.resolve("vite/package.json");
    return resolve(dirname(vitePackageJsonPath), "..");
  } catch {
    return null;
  }
};

const fsAllow = [
  searchForWorkspaceRoot(process.cwd()),
  resolve(process.cwd(), "node_modules"),
  resolveInstalledNodeModulesDir()
].filter((value): value is string => value !== null);

export default defineConfig({
  root: "web",
  plugins: [react({})],
  server: {
    port: webPort,
    strictPort,
    fs: {
      allow: fsAllow
    },
    proxy: {
      "/api/routes": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  },
  preview: {
    port: previewPort
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true
  }
});
