/**
 * Starts the editor: the theme that follows the system's light or dark, the file of
 * `tam-diagrams edit` when the page was opened with its token, and the page itself (App.svelte).
 */

import { mount } from "svelte";
import "./styles/tokens.css";
import "./styles/base.css";
import App from "./App.svelte";
import { messageOf } from "./disk.ts";
import { applyTheme } from "./lib/app.svelte.ts";
import { toast } from "./lib/overlays.svelte.ts";
import { ServedFile, tokenIn } from "./served.ts";

const dark = matchMedia("(prefers-color-scheme: dark)");
const theme = () => applyTheme(dark.matches ? "claude-dark" : "claude-light");
theme();
dark.addEventListener("change", theme);

/** The file the edit command serves, opened; undefined without one or when it did not open. */
async function servedFile(): Promise<{ served?: ServedFile; opened?: string }> {
  const token = tokenIn(location.search);
  if (!token) return {};
  const served = new ServedFile(token);
  try {
    const { source, notice } = await served.open();
    queueMicrotask(() => toast(notice));
    return { served, opened: source };
  } catch (reason) {
    queueMicrotask(() =>
      toast(`The file of the edit command did not open: ${messageOf(reason)}`, "error"),
    );
    return {};
  }
}

mount(App, { target: document.body, props: await servedFile() });
