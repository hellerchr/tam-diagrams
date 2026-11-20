<!-- Working indicator: a small ring that turns. -->
<script lang="ts">
  let { size = 12 }: { size?: number } = $props();
</script>

<span class="spinner" style:--size="{size}px" role="status" aria-label="Working"></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    border: calc(1.5 * var(--border-width)) solid
      color-mix(in srgb, var(--c-working) 25%, transparent);
    border-top-color: var(--c-working);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
