import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "import.meta.env.VITE_SNAPSHOT_URL": JSON.stringify(
      "http://localhost/forests-snapshot.json"
    )
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    passWithNoTests: false,
    setupFiles: ["tests/vitest-jsdom-setup.ts"]
  }
});
