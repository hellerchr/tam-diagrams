import { defineConfig } from "vite";

// A spike: tldraw as the canvas of the TAM editor. The library is read from the repository around it.
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
  resolve: { dedupe: ["react", "react-dom"] },
});
