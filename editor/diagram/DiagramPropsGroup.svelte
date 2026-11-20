<!-- A group of the diagram's Properties (DiagramProperties.svelte) under its title (DiagramFold.svelte), which folds it;
     the folded titles are remembered for every pane alike (Layout.folded). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Layout } from "./diagram-layout.svelte.ts";
  import DiagramFold from "./DiagramFold.svelte";

  let { title, layout, children }: { title: string; layout: Layout; children: Snippet } = $props();
  const closed = $derived(layout.folded(title));
</script>

<section class="group" class:closed>
  <DiagramFold {title} open={!closed} ontoggle={() => layout.fold(title)} />
  {#if !closed}{@render children()}{/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5) var(--space-5) var(--space-3);
    border-top: var(--border-width) solid var(--d-line);
  }
  .group > :global(:not(:first-child)) {
    margin-left: var(--space-2);
  }
  .closed {
    padding-bottom: var(--space-3);
  }
</style>
