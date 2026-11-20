<!-- The one modal surface: a dimmed window, a centred panel above it, Esc or a click outside closes it. Dialog builds
     its form on it; a panel with its own layout (Projects) uses it directly. `wide` gives the palette's width. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    onclose,
    wide = false,
    children,
  }: { label: string; onclose: () => void; wide?: boolean; children: Snippet } = $props();
</script>

<div class="scrim" role="presentation" onpointerdown={onclose}></div>
<div
  class="modal"
  class:wide
  role="dialog"
  aria-modal="true"
  aria-label={label}
  tabindex="-1"
  onkeydown={(e) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), onclose())}
>
  {@render children()}
</div>

<style>
  .modal {
    position: fixed;
    z-index: var(--z-dialog);
    /* Centred on whole pixels, by layout: a -50% translate, a fractional vh or an odd leftover would put text on a half pixel, blurred. */
    top: round(12vh, 1px);
    left: round(down, calc((100vw - var(--modal-width)) / 2), 1px);
    display: flex;
    flex-direction: column;
    --modal-width: min(var(--dialog-width), calc(100vw - 2 * var(--space-6)));
    width: var(--modal-width);
    max-height: calc(100dvh - 12vh - var(--space-6));
    border-radius: var(--radius-lg);
    background: var(--c-popover);
    box-shadow: var(--shadow-popover);
    outline: none;
    animation: var(--enter);
  }
  .wide {
    --modal-width: min(var(--palette-width), calc(100vw - 2 * var(--space-6)));
  }
</style>
