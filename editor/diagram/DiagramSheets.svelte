<!-- The dialogs of the diagram editor's window (DiagramView.svelte), each loaded when it first opens: the New diagram
     chooser (DiagramChooser.svelte; `ws.chooser`) and the help sheets (DiagramHelp.svelte; `ws.sheet`). A file that
     shows empty opens the chooser by itself, once: it has no type yet. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { lazy } from "../lib/lazy.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  let { ws, dirty = false }: { ws: Workbench; dirty?: boolean } = $props();

  const chooser = lazy(() => import("./DiagramChooser.svelte"));
  const help = lazy(() => import("./DiagramHelp.svelte"));

  let asked = false;
  $effect(() => {
    if (!ws.empty || asked) return;
    asked = true;
    untrack(ws.newDiagram);
  });
</script>

{#if ws.chooser}
  {#await chooser.load() then { default: DiagramChooser }}
    <DiagramChooser {ws} {dirty} onclose={() => (ws.chooser = false)} />
  {/await}
{/if}
{#if ws.sheet}
  {@const which = ws.sheet}
  {#await help.load() then { default: DiagramHelp }}
    <DiagramHelp {ws} {which} onclose={() => (ws.sheet = undefined)} />
  {/await}
{/if}
