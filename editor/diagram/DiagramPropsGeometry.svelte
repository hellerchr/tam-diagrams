<!-- The Geometry group of an element's Properties (DiagramPropsElements.svelte), as tam-diagrams' old inspector had it:
     where the one selected element stands and how large it is, to a tenth of a pixel. A new X or Y moves it with what
     it holds; a new W or H gives it that size. Each is one edit of the source, taken on Enter or leaving the field. -->
<script lang="ts">
  import type { Box } from "./diagram-hit.ts";
  import type { DiagramEditor } from "./diagram-editor.svelte.ts";
  import type { Layout } from "./diagram-layout.svelte.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ed, layout, P, id }: { ed: DiagramEditor; layout: Layout; P: Kit; id: string } = $props();
  const FIELDS: [keyof Box, string][] = [
    ["x", "X"],
    ["y", "Y"],
    ["width", "W"],
    ["height", "H"],
  ];
  const box = $derived(ed.elementBox(id));

  /** Moves or sizes the element to the number typed; nothing for a field left empty or not a number. */
  function setBox(side: keyof Box, text: string) {
    const value = P.typedNumber(text);
    const now = box;
    if (value === undefined || !now) return false;
    if (side === "x" || side === "y")
      return ed.apply((m, edits) =>
        edits.moved(m, [id], {
          x: side === "x" ? value - now.x : 0,
          y: side === "y" ? value - now.y : 0,
        }),
      );
    return ed.apply((m, edits) => edits.resized(m, id, { ...now, [side]: value }));
  }
</script>

<DiagramPropsGroup title="Geometry" {layout}>
  <div class="numbers">
    {#each FIELDS as [side, label] (side)}
      <label class="number">
        <span>{label}</span>
        <DiagramPropsText
          value={P.boxText(box, side)}
          {label}
          inputmode="decimal"
          oncommit={(text) => setBox(side, text)}
        />
      </label>
    {/each}
  </div>
</DiagramPropsGroup>

<style>
  .numbers {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .number {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  span {
    color: var(--d-text-2);
    font-size: var(--text-xs);
  }
  .number :global(input.field) {
    padding: 0 var(--space-2);
    font-variant-numeric: tabular-nums;
  }
</style>
