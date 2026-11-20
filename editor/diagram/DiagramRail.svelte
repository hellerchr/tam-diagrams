<!-- The diagram editor's tool rail (DiagramView.svelte), on the window's left edge as in tam-diagrams' editor: the
     pointer tools (select, pan, connect), the left panel's tabs (Shapes, Outline) and, at the foot, the right panel's
     toggle (Properties and source). A diagram edited as text is only panned: the other tools are off, saying why. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import { ICONS, type IconName } from "./diagram-icons.ts";
  import type { Tool, Workbench } from "./diagram-workbench.svelte.ts";

  let { ws }: { ws: Workbench } = $props();
  const layout = $derived(ws.layout);

  const TOOLS: { tool: Tool; icon: IconName; name: string; key: string }[] = [
    { tool: "select", icon: "select", name: "Select, move and resize", key: "V" },
    { tool: "pan", icon: "pan", name: "Pan: move the view", key: "H" },
    {
      tool: "connect",
      icon: "connect",
      name: "Connect: drag from one element to another",
      key: "C",
    },
  ];
  /** Why a tool is off: a type edited as text has no structure to point at. */
  const why = (tool: Tool) =>
    ws.textual && tool !== "pan"
      ? `${ws.current?.name ?? "Diagram"}s are edited as text`
      : undefined;
</script>

<nav class="rail" aria-label="Tools and panels">
  {#each TOOLS as t (t.tool)}
    {@const off = why(t.tool)}
    <Button
      variant="ghost"
      icon={ICONS[t.icon]}
      active={ws.tool === t.tool}
      aria-pressed={ws.tool === t.tool}
      aria-disabled={off ? "true" : undefined}
      title={off ?? `${t.name} (${t.key})`}
      onclick={() => !off && ws.pickTool(t.tool)}
    />
  {/each}
  <hr />
  <Button
    variant="ghost"
    icon={ICONS.shapes}
    active={layout.left === "shapes"}
    aria-pressed={layout.left === "shapes"}
    title="Shapes"
    onclick={() => layout.toggleLeft("shapes")}
  />
  <Button
    variant="ghost"
    icon={ICONS.outline}
    active={layout.left === "outline"}
    aria-pressed={layout.left === "outline"}
    title="Outline"
    onclick={() => layout.toggleLeft("outline")}
  />
  <span class="spacer"></span>
  <Button
    variant="ghost"
    icon={ICONS.panel}
    active={layout.side}
    aria-pressed={layout.side}
    title="Properties and source"
    onclick={() => (layout.side = !layout.side)}
  />
</nav>

<style>
  .rail {
    grid-area: rail;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-right: var(--border-width) solid var(--d-line);
    background: var(--d-panel-2);
  }
  /* A tool a type edited as text has no use for: dimmed, its title saying why. */
  .rail :global(.btn[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }
  hr {
    width: var(--space-7);
    margin: var(--space-2) 0;
    border: none;
    border-top: var(--border-width) solid var(--d-line);
  }
</style>
