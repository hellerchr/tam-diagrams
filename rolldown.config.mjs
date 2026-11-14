import { fileURLToPath } from "node:url";

// Bundles the command line into the one file `bin` points at: plain Node cannot load the sources,
// whose relative imports have no extensions. elkjs stays an import, installed beside the package.
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
