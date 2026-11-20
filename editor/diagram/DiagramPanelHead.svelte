<!-- The head row of a section of the diagram editor's side panels (DiagramPanel.svelte): the left panel's tabs, the
     right panel's Properties and Source. One height, so the panels' rows line up across the canvas. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<header class="head">{@render children()}</header>

<style>
  .head {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: var(--control-lg);
    padding: 0 var(--space-3);
    border-bottom: var(--border-width) solid var(--d-line);
  }
</style>
