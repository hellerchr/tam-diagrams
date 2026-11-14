import { fileURLToPath } from "node:url";

// Bundles the command line into the one file `bin` points at: Node does not strip
// TypeScript types in files under `node_modules`, so an installed package cannot run the sources. elkjs stays an import, installed beside the package.
export default {
  input: fileURLToPath(new URL("cli/bin.ts", import.meta.url)),
  platform: "node",
  external: [/^elkjs(\/|$)/],
  output: {
    file: "dist/cli.js",
    format: "esm",
    banner: "#!/usr/bin/env node",
  },
};
