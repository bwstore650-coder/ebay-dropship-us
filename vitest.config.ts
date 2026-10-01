import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts", "extension/test/**/*.test.mjs"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
