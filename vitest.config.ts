import { defineConfig } from "vitest/config";

// Run inside the package (`npm test`); repli's own vitest run includes these tests too.
export default defineConfig({
  test: { environment: "jsdom", globals: true, include: ["test/**/*.test.ts"] },
});
