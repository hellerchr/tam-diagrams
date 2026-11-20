// Tests for paper.ts: a dark theme's light twin, white under the diagram, and the CSS variables it is worn as.
import { test } from "vitest";
import assert from "node:assert/strict";
import { THEMES } from "../styles/themes.ts";
import { paperTheme, paperVars } from "./paper.ts";

test("a dark theme draws on its family's light theme, a light one on itself, the rest on Claude Light", () => {
  assert.equal(paperTheme("claude-dark").id, "claude-light");
  assert.equal(paperTheme("github-dark-dimmed").id, "github-light");
  assert.equal(paperTheme("catppuccin-mocha").id, "catppuccin-latte");
  assert.equal(paperTheme("vscode-dark-modern").id, "vscode-light-modern");
  assert.equal(paperTheme("solarized-light").id, "solarized-light");
  assert.equal(paperTheme("dracula").id, "claude-light");
});

test("every theme's paper is light and white", () => {
  for (const theme of THEMES) {
    const paper = paperTheme(theme.id);
    assert.equal(paper.dark, false, theme.id);
    assert.equal(paper.colors.surface, "#ffffff", theme.id);
  }
});

test("the paper is worn as the page's variables", () => {
  const vars = paperVars(paperTheme("claude-dark"));
  assert.match(vars, /--c-surface: #ffffff/);
  assert.match(vars, /--c-accent-foreground: #ffffff/);
  assert.match(vars, /--ansi-4: #2f6db5/);
});
