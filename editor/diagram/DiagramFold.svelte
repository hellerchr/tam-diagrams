<!-- The title that folds a part of the diagram editor's side panels: the right panel's Properties and Source, the
     Properties' groups (Identity, Layout, …), the Shapes' groups. The app's disclosure chevron (ui/Twist.svelte) and
     section heading (.list-heading); `end` holds the part's buttons after the title. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Twist from "../ui/Twist.svelte";

  let {
    title,
    open,
    ontoggle,
    end,
  }: { title: string; open: boolean; ontoggle: () => void; end?: Snippet } = $props();
</script>

<div class="fold">
  <button type="button" aria-expanded={open} onclick={ontoggle}>
    <Twist {open} />
    <h3 class="list-heading">{title}</h3>
  </button>
  {@render end?.()}
</div>

<style>
  .fold {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  button {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    height: var(--control-sm);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--c-muted);
    text-align: left;
  }
  button:hover {
    background: var(--d-hover);
  }
  button:hover h3 {
    color: var(--d-text);
  }
  h3 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
