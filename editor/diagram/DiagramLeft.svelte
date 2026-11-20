<!-- The diagram editor's left panel (DiagramView.svelte, a DiagramPanel): Shapes (DiagramShapes.svelte) or Outline
     (DiagramOutline.svelte), picked in its head, which take its whole height, and a close button. In a narrow window it
     lies over the canvas, and a press on the canvas puts it away. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import { LEFT, type LeftTab } from "./diagram-layout.svelte.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramOutline from "./DiagramOutline.svelte";
  import DiagramPanel from "./DiagramPanel.svelte";
  import DiagramPanelHead from "./DiagramPanelHead.svelte";
  import DiagramShapes from "./DiagramShapes.svelte";

  let { ws, tab, over }: { ws: Workbench; tab: LeftTab; over: boolean } = $props();
  const layout = $derived(ws.layout);

  const TABS: { value: LeftTab; label: string }[] = [
    { value: "shapes", label: "Shapes" },
    { value: "outline", label: "Outline" },
  ];

  // A press on the canvas puts away the panel that lies over it.
  $effect(() => {
    const stage = ws.stage;
    if (!over || !stage) return;
    const away = () => (layout.left = undefined);
    stage.addEventListener("pointerdown", away);
    return () => stage.removeEventListener("pointerdown", away);
  });
</script>

<DiagramPanel
  side="left"
  label="Shapes and outline"
  {over}
  width={layout.leftWidth}
  range={LEFT}
  onwidth={(w) => (layout.leftWidth = w)}
>
  <DiagramPanelHead>
    <Segmented options={TABS} value={tab} onselect={(next) => (layout.left = next)} />
    <span class="spacer"></span>
    <Button
      variant="ghost"
      size="sm"
      icon={ICONS.close}
      title="Close the panel"
      onclick={() => (layout.left = undefined)}
    />
  </DiagramPanelHead>
  {#if tab === "shapes"}
    <DiagramShapes {ws} />
  {:else}
    <DiagramOutline {ws} />
  {/if}
</DiagramPanel>
