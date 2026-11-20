import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Run inside the package (`npm test`): the library's tests in test/, the editor's beside its code.
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "editor/**/*.test.ts"],
  },
});
