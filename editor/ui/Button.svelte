<!-- The one button. Variants: default (bordered), primary (solid accent), ghost (no chrome), danger.
     With only `icon` it is a square icon button; `title` then labels it. `loading` swaps the icon for a spinner and
     disables the button. `menu` adds a chevron (MenuButton) and lets a long label shrink; `element` binds the button. -->
<script lang="ts">
  import { ChevronDown, type IconNode } from "lucide";
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import Spinner from "./Spinner.svelte";

  type Props = HTMLButtonAttributes & {
    variant?: "default" | "primary" | "ghost" | "danger";
    size?: "sm" | "md";
    icon?: IconNode;
    active?: boolean;
    loading?: boolean;
    menu?: boolean;
    element?: HTMLButtonElement;
    children?: Snippet;
  };
  let {
    variant = "default",
    size = "md",
    icon,
    active = false,
    loading = false,
    menu = false,
    element = $bindable(),
    children,
    class: className = "",
    ...rest
  }: Props = $props();
</script>

<button
  class="btn {variant} {size} {className}"
  class:square={(icon || loading) && !children}
  class:active
  class:menu
  bind:this={element}
  aria-label={icon && !children ? rest.title : undefined}
  {...rest}
  disabled={loading || rest.disabled}
>
  {#if loading}<Spinner size={size === "sm" ? 12 : 14} />{:else if icon}<Icon
      {icon}
      size={size === "sm" ? 14 : 16}
    />{/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
  {#if menu}<span class="chevron"><Icon icon={ChevronDown} size={12} /></span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: var(--control-md);
    padding: 0 var(--space-5);
    border-radius: var(--radius-md);
    border: var(--border-width) solid var(--c-border);
    background: var(--c-surface);
    color: var(--c-foreground);
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    user-select: none;
    transition:
      background var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .btn:hover:not(:disabled) {
    background: var(--c-hover);
  }
  .btn:active:not(:disabled) {
    background: var(--c-selected);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .sm {
    height: var(--control-sm);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    gap: var(--space-2);
  }
  .square {
    width: var(--control-md);
    padding: 0;
  }
  .sm.square {
    width: var(--control-sm);
  }
  .primary {
    background: var(--c-solid);
    color: var(--c-solid-foreground);
    border-color: transparent;
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--c-solid) 88%, var(--c-foreground));
  }
  .ghost {
    background: transparent;
    border-color: transparent;
    color: var(--c-muted);
  }
  .ghost:hover:not(:disabled) {
    color: var(--c-foreground);
  }
  .ghost.active {
    color: var(--c-foreground);
    background: var(--c-selected);
  }
  .danger {
    color: var(--c-danger);
  }
  .danger:hover:not(:disabled) {
    background: var(--c-danger-soft);
  }
  .menu {
    min-width: 0;
  }
  .chevron {
    display: flex;
    margin-left: calc(-1 * var(--space-1));
    color: var(--c-muted);
  }
  .primary .chevron {
    color: inherit;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
