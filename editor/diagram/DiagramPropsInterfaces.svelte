<!-- The Interfaces group of an element's Properties (DiagramPropsElements.svelte), as tam-diagrams' old inspector had
     it: an interface is named, then added as one the element provides or requires. Interfaces belong to the design
     level: only a diagram that has it already offers them, at elements that may take one. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import type { Model } from "./diagram-edit.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsSegments from "./DiagramPropsSegments.svelte";

  let { ws, P, m, id }: { ws: Workbench; P: Kit; m: Model; id: string } = $props();
  const OFFERS = [
    { value: "provides", name: "Provides" },
    { value: "requires", name: "Requires" },
  ] as const;
  const shown = $derived(P.designLevel(m.diagram) && P.allowsInterface(m.source, id));
  let offers = $state<"provides" | "requires">("provides");
  let name = $state("");
  let field = $state<HTMLInputElement>();

  function add() {
    if (!name.trim()) return field?.focus();
    ws.ed.apply((model) => P.interfaceAdded(model.source, id, offers, name));
    name = "";
  }
</script>

{#if shown}
  <DiagramPropsGroup title="Interfaces" layout={ws.layout}>
    <input
      class="field"
      type="text"
      placeholder="Name, for example IOrders"
      aria-label="Name of the interface"
      spellcheck="false"
      bind:value={name}
      bind:this={field}
      onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
    />
    <div class="inline">
      <DiagramPropsSegments options={OFFERS} value={offers} onpick={(value) => (offers = value)} />
      <Button onclick={add}>Add</Button>
    </div>
  </DiagramPropsGroup>
{/if}

<style>
  .inline {
    display: flex;
    gap: var(--space-4);
    min-width: 0;
  }
</style>
