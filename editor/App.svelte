<!-- The editor's page: one diagram in the diagram editor (DiagramView.svelte), its source in the code pane of its right
     panel (source.ts). The source is the one truth: an edit on the canvas or typed is a new source in the history
     (history.ts). Opened by `tam-diagrams edit <file>`, it reads and saves that file (served.ts); else the diagram
     lives in the browser's storage. The guide sheet and the export dialog load when first opened. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { parseTam } from "../src/tam.ts";
  import type { Known } from "./completion.ts";
  import type { Format } from "./diagram/diagram-export.ts";
  import DiagramView from "./diagram/DiagramView.svelte";
  import { History } from "./history.ts";
  import { applied } from "./lib/app.svelte.ts";
  import type { Picture } from "./lib/diagrams.ts";
  import { openMenu, toast } from "./lib/overlays.svelte.ts";
  import { messageOf } from "./disk.ts";
  import { type ServedFile } from "./served.ts";
  import { SourcePane } from "./source.ts";
  import { STARTER } from "./starter.ts";
  import { store, stored } from "./storage.ts";
  import { typeOf } from "./types.ts";
  import Overlays from "./ui/Overlays.svelte";

  type Props = { served?: ServedFile; opened?: string };
  let { served, opened }: Props = $props();

  // svelte-ignore state_referenced_locally: the history starts from what the page opened with.
  const history = new History(opened ?? stored("source") ?? STARTER);
  let source = $state(history.source);
  /** The source as it was saved last: the dirty dot shows while the one on show differs. */
  let saved = $state(stored("saved") ?? history.source);
  let steps = $state({ undo: false, redo: false });
  /** A `.mmd` file is Mermaid only; anything else may be a block diagram too. */
  const lang = $derived(served && /\.(mmd|mermaid)$/i.test(served.name) ? "mermaid" : "tam");
  const name = $derived(served?.name ?? `diagram.${typeOf(source) === "tam" ? "tam" : "mmd"}`);

  let guide = $state<{ all: boolean }>();
  let guidePanel = $state<{ showsCurrent(): boolean; showCurrent(): void; showAll(): void }>();
  let exporting = $state.raw<{ picture: Picture; format?: Format }>();
  let cursor = $state<{ line: number }>();
  const host = document.createElement("div");
  host.className = "source";
  let pane: SourcePane | undefined;

  /** Shows `next` as the source: in the history, the code pane and the browser's storage. */
  function show(next: string, join = false, typed = false) {
    history.edit(next, join);
    settle(typed);
  }

  /** The source on show follows the history; the pane takes it unless it was typed there. */
  function settle(typed = false) {
    source = history.source;
    steps = { undo: history.canUndo, redo: history.canRedo };
    if (!typed) pane?.setText(source);
    pane?.setType(typeOf(source));
    store("source", source);
  }

  const step = (redo: boolean) => (history.step(redo), settle());

  /** The elements of a block diagram with what holds them, for the code pane's completions. */
  function elements(): Known[] {
    try {
      return [...parseTam(source).nodes.values()].map(({ id, kind, label, parent }) => ({
        id,
        kind,
        label,
        parent,
      }));
    } catch {
      return [];
    }
  }

  onMount(() => {
    pane = new SourcePane(host, {
      changed: (text, whole) => show(text, !whole, true),
      elements,
      completes: () => typeOf(source) === "tam",
      type: () => typeOf(source),
      undo: () => step(false),
      redo: () => step(true),
      cursorAt: (line) => (cursor = { line }),
    });
    pane.setText(source);
    // The page's own keys, which the menus name: Ctrl+S saves, F1 opens or closes the guide.
    const keys = (event: KeyboardEvent) => {
      const saving = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (!saving && event.key !== "F1") return;
      event.preventDefault();
      if (saving) void save();
      else toggleGuide();
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  });

  /** Writes the file of the edit command; without one the browser's storage keeps the diagram. */
  async function save() {
    const text = source;
    try {
      if (served) await served.save(text);
      saved = text;
      store("saved", text);
      toast(served ? `Saved to ${served.name}.` : "Saved in this browser.");
    } catch (reason) {
      toast(messageOf(reason), "error");
    }
  }

  /** Opens the guide of the source's type, or closes it when it shows that guide; "all" opens the list of all. */
  function toggleGuide(page?: "all") {
    if (!guide) guide = { all: page === "all" };
    else if (page === "all") guidePanel?.showAll();
    else if (guidePanel?.showsCurrent()) guide = undefined;
    else guidePanel?.showCurrent();
  }

  /** A guide's example in place of the diagram: at once for an empty one, else after the user said so. */
  function useExample(example: string, anchor: HTMLElement, replace: (next: string) => void) {
    if (!source.trim()) return replace(example);
    openMenu(anchor, [{ label: "Replace the diagram on show", action: () => replace(example) }], {
      above: true,
    });
  }

  const guideModule = () => import("./diagram/GuidePanel.svelte");
  const exportModule = () => import("./diagram/DiagramExport.svelte");
</script>

{#snippet sheet(shell: { showSource: () => void; replace: (source: string) => void })}
  {#if guide}
    {#await guideModule() then { default: GuidePanel }}
      <GuidePanel
        bind:this={guidePanel}
        {lang}
        {source}
        all={guide.all}
        oninsert={(row) => (shell.showSource(), pane?.insert(row))}
        onexample={(example, anchor) => useExample(example, anchor, shell.replace)}
        onclose={() => (guide = undefined)}
      />
    {/await}
  {/if}
{/snippet}

<main class="app" data-theme={applied.theme}>
  <DiagramView
    {source}
    {lang}
    onedit={(next) => show(next)}
    onhistory={step}
    onproblem={(line) => requestAnimationFrame(() => pane?.focusLine(line || 1))}
    {cursor}
    onlines={(lines) => pane?.setSelectedLines(lines)}
    onguide={toggleGuide}
    guide={guide && sheet}
    onexport={(picture, format) => (exporting = { picture, format })}
    onsave={() => void save()}
    sourcePane={host}
    canUndo={steps.undo}
    canRedo={steps.redo}
    dirty={source !== saved}
  />
</main>
{#if exporting}
  {#await exportModule() then { default: DiagramExport }}
    <DiagramExport
      path={name}
      picture={exporting.picture}
      format={exporting.format}
      onclose={() => (exporting = undefined)}
    />
  {/await}
{/if}
<Overlays />

<style>
  .app {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--c-canvas);
    color: var(--c-foreground);
  }
  .app :global(.source) {
    height: 100%;
    min-height: 0;
  }
</style>
