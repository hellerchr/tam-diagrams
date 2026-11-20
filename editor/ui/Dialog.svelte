<!-- A modal form (on Modal): a title, the fields (`children`), then Cancel and the submit button. Esc or a click
     outside closes it; Enter in a field submits. Without `onsubmit` it only shows something, with a Close button.
     The first field (else the submit button) takes the focus when it opens; `danger` turns the submit button red; `alt`
     adds a second answer before Cancel ("Don't Save"). -->
<script lang="ts">
  import { type Snippet, tick } from "svelte";
  import Button from "./Button.svelte";
  import Modal from "./Modal.svelte";

  let {
    title,
    onclose,
    onsubmit,
    submit = "Save",
    danger = false,
    disabled = false,
    wide = false,
    alt,
    onalt,
    children,
  }: {
    title: string;
    onclose: () => void;
    onsubmit?: () => void;
    submit?: string;
    danger?: boolean;
    disabled?: boolean;
    wide?: boolean;
    alt?: string;
    onalt?: () => void;
    children?: Snippet;
  } = $props();

  let form = $state<HTMLFormElement>();
  void tick().then(() =>
    form?.querySelector<HTMLElement>("input, textarea, select, button[type=submit]")?.focus(),
  );
</script>

<Modal label={title} {onclose} {wide}>
  <form bind:this={form} onsubmit={(e) => (e.preventDefault(), !disabled && onsubmit?.())}>
    <h2>{title}</h2>
    {#if children}<div class="body">{@render children()}</div>{/if}
    <div class="buttons">
      {#if onsubmit}
        {#if alt}<Button type="button" variant="ghost" onclick={onalt}>{alt}</Button>{/if}
        <Button type="button" variant="ghost" onclick={onclose}>Cancel</Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} {disabled}>{submit}</Button>
      {:else}
        <Button type="submit" variant="primary" onclick={onclose}>Close</Button>
      {/if}
    </div>
  </form>
</Modal>

<style>
  form {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: var(--space-6);
  }
  h2 {
    margin: 0 0 var(--space-5);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-height: 0;
    overflow-y: auto;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }
</style>
