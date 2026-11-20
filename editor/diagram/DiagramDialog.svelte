<!-- A dialog of the diagram editor, as the old editor's dialogs.ts made them (on ui/Modal): its title and a close
     button at the top, its body (which scrolls when the window is small), and a row of buttons at the bottom that
     stays. It closes by its button, by Escape, or by a click beside it; Tab goes round inside it, and no
     key in it reaches the window. The focus starts on the dialog itself, unless
     something in it is marked `data-autofocus`. -->
<script lang="ts">
  import { X } from "lucide";
  import type { Snippet } from "svelte";
  import Button from "../ui/Button.svelte";
  import Modal from "../ui/Modal.svelte";

  type Props = {
    title: string;
    /** The dialog's width in pixels, at most the window's. */
    width: number;
    onclose: () => void;
    onkeydown?: (event: KeyboardEvent) => void;
    children: Snippet;
    footer?: Snippet;
  };
  let { title, width, onclose, onkeydown, children, footer }: Props = $props();

  /** Every key in the dialog is the dialog's (Escape goes on to close it): Tab goes round inside it, from the last
   *  stop to the first and back. */
  function key(event: KeyboardEvent) {
    onkeydown?.(event);
    if (event.key !== "Escape") event.stopPropagation();
    if (event.key !== "Tab") return;
    const box = event.currentTarget as HTMLElement;
    const stops = [
      ...box.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"),
    ].filter((stop) => stop.tabIndex >= 0 && stop.getClientRects().length > 0);
    const active = document.activeElement;
    const next = event.shiftKey
      ? (active === stops[0] || active === box) && stops.at(-1)
      : active === stops.at(-1) && stops[0];
    if (!stops.length || next) event.preventDefault();
    if (next) next.focus();
  }

  /** The focus goes into the dialog when it opens, and back where it was when it closes. */
  function focus(box: HTMLElement) {
    const before = document.activeElement;
    (box.querySelector<HTMLElement>("[data-autofocus]") ?? box).focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }
</script>

<div class="width" style:--dialog-width="{width}px">
  <Modal label={title} {onclose}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dialog" tabindex="-1" onkeydown={key} {@attach focus}>
      <header>
        <h1>{title}</h1>
        <Button variant="ghost" size="sm" icon={X} title="Close (Esc)" onclick={onclose} />
      </header>
      <div class="body">{@render children()}</div>
      {#if footer}<footer>{@render footer()}</footer>{/if}
    </div>
  </Modal>
</div>

<style>
  .width {
    display: contents;
  }
  .dialog {
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: var(--text-sm);
    outline: none;
  }
  header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
    border-bottom: var(--border-width) solid var(--c-border);
  }
  h1 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }
  .body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-top: var(--border-width) solid var(--c-border);
  }
  /* The old dialogs' section titles. */
  .dialog :global(h2) {
    margin: 0;
    color: var(--c-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
