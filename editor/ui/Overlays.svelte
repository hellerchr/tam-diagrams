<!-- Draws what lib/overlays opens: the menu (Menus.svelte), the prompt dialog, the picture viewer and the toasts. Mounted
     once by the App. -->
<script lang="ts">
  import { X } from "lucide";
  import { tick } from "svelte";
  import { ALT, dismissToast, overlays } from "../lib/overlays.svelte.ts";
  import Button from "./Button.svelte";
  import Dialog from "./Dialog.svelte";
  import Lightbox from "./Lightbox.svelte";
  import Menus from "./Menus.svelte";

  let value = $state("");
  let inputEl = $state<HTMLInputElement>();

  $effect(() => {
    const prompt = overlays.prompt;
    if (!prompt) return;
    value = prompt.value ?? "";
    // Dialog focuses the input (or for a yes / no question the confirm button, so Enter answers it); then select.
    void tick().then(() =>
      prompt.select ? inputEl?.setSelectionRange(...prompt.select) : inputEl?.select(),
    );
  });

  function finish(ok: boolean | typeof ALT) {
    const prompt = overlays.prompt;
    overlays.prompt = undefined;
    prompt?.resolve(ok === ALT ? ALT : ok ? (prompt.input ? value : "") : undefined);
  }
</script>

<Menus />

{#if overlays.image}
  <Lightbox src={overlays.image} onclose={() => (overlays.image = undefined)} />
{/if}

{#if overlays.prompt}
  {@const prompt = overlays.prompt}
  {#key prompt}
    <Dialog
      title={prompt.title}
      submit={prompt.confirm ?? "OK"}
      danger={prompt.danger}
      alt={prompt.alt}
      onalt={() => finish(ALT)}
      onsubmit={() => finish(true)}
      onclose={() => finish(false)}
    >
      {#if prompt.message}<p>{prompt.message}</p>{/if}
      {#if prompt.input}<input
          class="input"
          bind:this={inputEl}
          bind:value
          placeholder={prompt.placeholder}
          aria-label={prompt.title}
        />{/if}
    </Dialog>
  {/key}
{/if}

<div class="toasts" aria-live="polite">
  {#each overlays.toasts as t (t.id)}
    <div class="toast" class:error={t.kind === "error"} class:actionable={t.action}>
      {t.text}
      {#if t.action}
        {@const action = t.action}
        <Button size="sm" variant="primary" onclick={() => (dismissToast(t.id), action.run())}
          >{action.label}</Button
        >
        <Button
          size="sm"
          variant="ghost"
          icon={X}
          title="Dismiss"
          onclick={() => dismissToast(t.id)}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  p {
    margin: 0;
    color: var(--c-muted);
    font-size: var(--text-md);
  }
  .input {
    width: 100%;
    height: var(--control-lg);
  }
  .toasts {
    position: fixed;
    z-index: var(--z-toast);
    bottom: calc(var(--space-6) + env(safe-area-inset-bottom));
    right: calc(var(--space-6) + env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    pointer-events: none;
  }
  .toast {
    max-width: min(var(--toast-width), calc(100vw - 2 * var(--space-6)));
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-md);
    background: var(--c-popover);
    box-shadow: var(--shadow-popover);
    font-size: var(--text-md);
    animation: var(--enter);
  }
  .actionable {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-right: var(--space-3);
    pointer-events: auto;
  }
  .toast.error {
    color: var(--c-danger);
  }
</style>
