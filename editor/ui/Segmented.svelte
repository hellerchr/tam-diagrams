<!-- A few exclusive choices side by side, one selected; `onselect` gets the picked value. An option's `title` is its tooltip;
     a `disabled` one is dimmed (its title says why). -->
<script lang="ts" generics="V extends string">
  type Option = { value: V; label: string; title?: string; disabled?: boolean };
  let {
    options,
    value,
    onselect,
  }: { options: readonly Option[]; value: V; onselect: (value: V) => void } = $props();
</script>

<div class="segmented" role="radiogroup">
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={option.value === value}
      class:on={option.value === value}
      title={option.title}
      disabled={option.disabled}
      onclick={() => onselect(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    flex: none;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: var(--c-input);
  }
  button {
    height: calc(var(--control-sm) - var(--space-1));
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    color: var(--c-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    color: var(--c-foreground);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .on {
    background: var(--c-surface);
    color: var(--c-foreground);
    box-shadow: 0 0 0 var(--border-width) var(--c-border);
  }
</style>
