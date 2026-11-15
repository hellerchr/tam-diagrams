// @vitest-environment node
// The package is self-contained: it imports only its own files and elkjs (tests also vitest, mermaid and node; the editor's build also vite).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    // Spikes try other libraries out and are no part of the package.
    entry.name === "node_modules" || entry.name === "spikes"
      ? []
      : entry.isDirectory()
        ? files(join(dir, entry.name))
        : /\.tsx?$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
  );

describe("package boundary", () => {
  it("imports only its own files, elkjs and, outside src, vitest, mermaid, node and vite", () => {
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
              (file === join("editor", "vite.config.ts") && spec === "vite")
            ),
      );
    expect(outside).toEqual([]);
  });
});
