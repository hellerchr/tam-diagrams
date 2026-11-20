// @vitest-environment node
// The package is self-contained: it imports only its own files and elkjs (tests also vitest, mermaid and node; the editor also vite and CodeMirror).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules"
      ? []
      : entry.isDirectory()
        ? files(join(dir, entry.name))
        : /\.(tsx?|svelte)$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
  );

describe("package boundary", () => {
  it("imports only its own files, elkjs and, outside src, vitest, mermaid, node, vite and the editor's Svelte", () => {
    const outside = files(root)
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map(
          ([, spec]) => ({ file: relative(root, file), spec }),
        ),
      )
      .filter(({ file, spec }) =>
        spec.startsWith(".")
          ? relative(root, resolve(root, file, "..", spec)).startsWith("..")
          : !(
              spec.startsWith("elkjs/") ||
              (!file.startsWith("src") &&
                (spec.startsWith("vitest") || spec === "mermaid" || spec.startsWith("node:"))) ||
              ([join("editor", "vite.config.ts"), "vitest.config.ts"].includes(file) &&
                (spec === "vite" || spec === "@sveltejs/vite-plugin-svelte")) ||
              // The editor is Svelte, with Lucide's icons.
              (/^editor/.test(file) && /^(svelte|lucide)(\/|$)/.test(spec)) ||
              // The editor's source pane is CodeMirror.
              (/^(editor|test)/.test(file) && /^@(codemirror|lezer)\//.test(spec))
            ),
      );
    expect(outside).toEqual([]);
  });
});
