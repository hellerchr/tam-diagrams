<!-- A side panel of the diagram editor (DiagramView.svelte): the left one (Shapes, Outline: DiagramLeft.svelte) and the
     right one (Properties, Source: DiagramSide.svelte). A column beside the canvas with a resizer on its inner edge (a
     double click: as wide as it started); `over` the canvas in a narrow window, without one. Its rows start with a
     DiagramPanelHead, so both panels line up. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Resizer from "../ui/Resizer.svelte";

  type Props = {
    side: "left" | "right";
    label: string;
    over: boolean;
    width: number;
    /** The widths it starts at and may be dragged between. */
    range: { start: number; least: number; most: number };
    onwidth: (width: number) => void;
    element?: HTMLElement;
    children: Snippet;
  };
  let {
    side,
    label,
    over,
    width,
    range,
    onwidth,
    element = $bindable(),
    children,
  }: Props = $props();
</script>

<aside
  class="panel {side}"
  class:over
  aria-label={label}
  bind:this={element}
  style:width={over ? `${width}px` : undefined}
>
  {@render children()}
  {#if !over}
    <div class="resize">
      <Resizer
        bind:width={() => width, onwidth}
        {side}
        min={range.least}
        max={range.most}
        onreset={() => onwidth(range.start)}
      />
    </div>
  {/if}
</aside>

<style>
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--d-panel);
  }
  .left {
    grid-area: left;
    border-right: var(--border-width) solid var(--d-line);
  }
  .right {
    grid-area: side;
    border-left: var(--border-width) solid var(--d-line);
  }
  .over {
    z-index: 8;
    max-width: 100%;
    grid-area: stage;
    box-shadow: var(--shadow-popover);
  }
  .left.over {
    justify-self: start;
  }
  .right.over {
    justify-self: end;
  }
  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 4;
    display: flex;
  }
  .left .resize {
    right: calc(var(--resizer-hit) / -2);
  }
  .right .resize {
    left: calc(var(--resizer-hit) / -2);
  }
</style>
