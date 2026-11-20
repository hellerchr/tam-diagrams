<!-- Buttons of which one is on, joined into one control, in the diagram's Properties (DiagramProperties.svelte): the
     app's segmented control (ui/Segmented.svelte) as wide as the row, with icons and refusals. A button
     shows a name or an icon (its tooltip names it); one the notation refuses is off, its tooltip saying why. -->
<script lang="ts" generics="V extends string">
  import type { IconNode } from "lucide";
  import Icon from "../ui/Icon.svelte";

  type Segment = { value: V; name?: string; icon?: IconNode; tip?: string };
  type Props = {
    options: readonly Segment[];
    value: V | undefined;
    refusal?: (value: V) => string | undefined;
    onpick: (value: V) => unknown;
  };
  let { options, value, refusal, onpick }: Props = $props();
</script>

<div class="segments">
  {#each options as option (option.value)}
    {@const on = option.value === value}
    {@const off = on ? undefined : refusal?.(option.value)}
    <button
      class="segment"
      type="button"
      aria-pressed={on}
      aria-disabled={!!off}
      aria-label={option.name ? undefined : option.tip}
      title={off ?? option.tip}
      onclick={() => !off && onpick(option.value)}
    >
      {#if option.icon}<Icon icon={option.icon} size={16} />{/if}{option.name ?? ""}
    </button>
  {/each}
</div>

<style>
  /* As ui/Segmented.svelte: the buttons on a filled track, the one on raised from it. */
  .segments {
    display: flex;
    flex: 1;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: var(--c-input);
  }
  .segment {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-width: 0;
    height: calc(var(--d-control) - 2 * var(--space-1));
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--c-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .segment:hover {
    color: var(--c-foreground);
  }
  .segment[aria-pressed="true"] {
    background: var(--c-surface);
    color: var(--c-foreground);
    box-shadow: 0 0 0 var(--border-width) var(--c-border);
  }
  .segment[aria-disabled="true"] {
    opacity: 0.45;
    cursor: default;
  }
  .segment:focus-visible {
    outline: 2px solid var(--d-accent);
    outline-offset: -2px;
  }
</style>
