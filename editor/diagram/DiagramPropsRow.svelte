<!-- A labelled row of the diagram's Properties (DiagramProperties.svelte): the label in a 64 px column, the control
     beside it. A `label` row lets a click on the label reach its field; a `check` row holds a checkbox. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    label: string;
    tag?: "label" | "div";
    check?: boolean;
    title?: string;
    hidden?: boolean;
    children: Snippet;
  };
  let { label, tag = "label", check = false, title, hidden = false, children }: Props = $props();
</script>

<svelte:element this={tag} class="row" class:check {title} {hidden}>
  <span>{label}</span>
  {@render children()}
</svelte:element>

<style>
  .row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    min-height: var(--d-control);
  }
  .row[hidden] {
    display: none;
  }
  span {
    color: var(--d-text-2);
  }
  .check :global(input) {
    justify-self: start;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--d-accent);
  }
</style>
