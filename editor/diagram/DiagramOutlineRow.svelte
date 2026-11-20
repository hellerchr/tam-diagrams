<!-- A row of the diagram outline's tree (DiagramOutline.svelte), as the old outline.ts drew it: the arrow that opens
     and closes an element that holds others (Alt: all inside it), its drawing, its name, and how many elements a
     closed one holds. Indented 14 px a level; selected, focused or a drop's target, it says so. -->
<script lang="ts">
  import Icon from "../ui/Icon.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import type { Look } from "./diagram-outline-look.ts";
  import type { TreeRow } from "./diagram-outline.ts";

  type Props = {
    row: TreeRow;
    look: Look;
    selected: boolean;
    /** A dragged element would go into this one. */
    over: boolean;
    /** The tree's stop for Tab. */
    stop: boolean;
    ontoggle: (deep: boolean) => void;
    onclick: (e: MouseEvent) => void;
    ondblclick: () => void;
    oncontextmenu: (e: MouseEvent) => void;
    onkeydown: (e: KeyboardEvent) => void;
    onfocus: () => void;
    ondragstart: (e: DragEvent) => void;
    ondragover: (e: DragEvent) => void;
    ondragleave: () => void;
    ondrop: (e: DragEvent) => void;
  };
  let { row, look, selected, over, stop, ontoggle, ...on }: Props = $props();
</script>

<div
  class="node"
  class:over
  role="treeitem"
  tabindex={stop ? 0 : -1}
  draggable="true"
  aria-selected={selected}
  aria-expanded={row.parent ? !row.folded : undefined}
  data-id={row.item.id}
  title={look.tip}
  style:padding-left="{4 + row.depth * 14}px"
  {...on}
>
  {#if row.parent}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <span
      class="twist"
      role="button"
      tabindex="-1"
      title={row.folded ? "Expand (Alt: all inside)" : "Collapse (Alt: all inside)"}
      aria-label={row.folded ? "Expand" : "Collapse"}
      aria-expanded={!row.folded}
      draggable="false"
      onclick={(e) => (e.stopPropagation(), ontoggle(e.altKey))}
      ondblclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
    >
      <Icon icon={ICONS.chevron} size={16} />
    </span>
  {:else}
    <span class="twist none"></span>
  {/if}
  <span class="drawing"><Icon icon={ICONS[look.icon]} size={16} /></span>
  <span class="name">{look.name}</span>
  {#if row.parent && row.folded}<span class="count">{row.count}</span>{/if}
</div>

<style>
  .node {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--control-sm);
    padding-right: var(--space-4);
    outline: none;
    cursor: default;
    white-space: nowrap;
  }
  .node:hover {
    background: var(--d-hover);
  }
  .node[aria-selected="true"] {
    background: var(--d-accent-soft);
  }
  :global(.tree:focus-within) .node:focus,
  .node.over {
    box-shadow: inset 0 0 0 var(--rule-width) var(--d-accent);
  }
  .drawing {
    display: inline-flex;
    flex: none;
    color: var(--d-text-2);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .twist {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--control-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .twist:not(.none):hover {
    background: var(--d-active);
  }
  .twist :global(.icon) {
    transition: rotate var(--dur-base);
  }
  .twist[aria-expanded="false"] :global(.icon) {
    rotate: -90deg;
  }
  :global(.tree.flat) .twist {
    width: var(--space-2);
  }
  .count {
    margin-left: auto;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--d-hover);
    color: var(--d-text-2);
    font-size: var(--text-xs);
  }
</style>
