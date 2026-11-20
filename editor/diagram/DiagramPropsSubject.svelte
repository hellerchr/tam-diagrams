<!-- What the diagram's Properties (DiagramProperties.svelte) are about, above their groups: an icon and a name
     (Diagram, Element, Connection, 3 elements, …), with a detail such as the diagram's type. -->
<script lang="ts">
  import type { IconNode } from "lucide";
  import Icon from "../ui/Icon.svelte";

  let { icon, title, detail = "" }: { icon: IconNode; title: string; detail?: string } = $props();
</script>

<div class="subject">
  <Icon {icon} size={16} />
  <strong>{title}</strong>
  {#if detail}<span>{detail}</span>{/if}
</div>

<style>
  .subject {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: calc(var(--space-7) + var(--space-5));
    padding: 0 var(--space-5);
  }
  .subject :global(.icon) {
    color: var(--d-text-2);
  }
  strong {
    font-weight: var(--weight-semibold);
  }
  span {
    color: var(--d-text-2);
  }
</style>
