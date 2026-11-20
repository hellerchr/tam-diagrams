<!-- The Arrange group of the elements' Properties (DiagramPropsElements.svelte), as tam-diagrams' old inspector had it:
     aligning and spreading (two or three elements and more), making sizes one or fitting them to the contents, each
     button off with why while too few are selected; and laying out only what is selected, the parts of one element
     that holds others or several elements among themselves. -->
<script lang="ts">
  import { elkLayout } from "../lib/diagrams.ts";
  import Button from "../ui/Button.svelte";
  import type { Model } from "./diagram-edit.ts";
  import { ICONS, type IconName } from "./diagram-icons.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import { ARRANGE, type Arranging, arrangeRefusal } from "./diagram-arrange.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";

  let { ws, P, m, ids }: { ws: Workbench; P: Kit; m: Model; ids: string[] } = $props();
  const ed = $derived(ws.ed);
  const ROWS = ["Align", "Distribute", "Size"] as const;
  const can = $derived(P.canLayOut(m.diagram, ids));
  let laying = $state(false);

  function run(does: Arranging["does"]) {
    if (does === "same-width" || does === "same-height")
      ed.sameSize(does === "same-width" ? "width" : "height");
    else if (does === "fit-size") ed.fitSize();
    else ed.arrange(does);
  }

  /** Lays out what is selected (its layout takes a moment); written when the source has not moved on meanwhile. */
  async function layOut() {
    const { source, font } = m;
    const placed = ed.edits?.placed(m);
    if (!placed) return;
    laying = true;
    try {
      const next = await P.laidOutWithin(placed, ids, font, await elkLayout());
      if (ws.source === source) ed.amend(() => next);
    } finally {
      laying = false;
    }
  }
</script>

<DiagramPropsGroup title="Arrange" layout={ws.layout}>
  {#each ROWS as row (row)}
    <DiagramPropsRow label={row} tag="div">
      <div class="icons">
        {#each ARRANGE[row] as action (action.does)}
          {@const off = arrangeRefusal(action, ids.length)}
          <Button
            variant="ghost"
            size="sm"
            icon={ICONS[action.icon as IconName]}
            title={off ?? action.name}
            disabled={!!off}
            onclick={() => run(action.does)}
          />
        {/each}
      </div>
    </DiagramPropsRow>
  {/each}
  <div class="actions">
    <Button
      icon={ICONS.layout}
      loading={laying}
      disabled={!can}
      title={can ? undefined : "This element holds no others to lay out"}
      onclick={() => void layOut().catch(() => {})}
      >{ids.length === 1 ? "Auto layout inside" : "Auto layout these"}</Button
    >
  </div>
</DiagramPropsGroup>

<style>
  .icons {
    display: flex;
    gap: var(--space-1);
  }
</style>
