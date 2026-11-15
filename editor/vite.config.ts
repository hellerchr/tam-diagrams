import { defineConfig } from "vite";

// The editor is a static page: `npm run editor` serves it, `npm run build:editor` writes it to dist/editor.
export default defineConfig({
  base: "./",
  build: { outDir: "../dist/editor", emptyOutDir: true, target: "es2023" },
});
