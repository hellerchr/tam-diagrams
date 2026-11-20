<!-- The search row at the top of a tab of the diagram editor's left panel (DiagramShapes.svelte, DiagramOutline.svelte),
     as the old editor's tab tools: a field that finds as it is typed (the shell's .field, DiagramView.svelte), and the
     tab's buttons after it. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    value = $bindable(""),
    label,
    children,
  }: { value?: string; label: string; children?: Snippet } = $props();
</script>

<div class="tab-tools">
  <input class="field" type="search" placeholder="{label}…" aria-label={label} bind:value />
  {@render children?.()}
</div>

<style>
  .tab-tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-4);
  }
  .field:not(:last-child) {
    margin-right: var(--space-1);
  }
</style>
