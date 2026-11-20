<!-- The Properties of one or several elements of a block diagram (DiagramProperties.svelte), as tam-diagrams' old
     inspector had them: the name and id of one, the kind (only those the notation takes where each stands) and color of
     all, how many they stand for and where the copy of one shown as several stands; one's box (DiagramPropsGeometry),
     arranging (DiagramPropsArrange), interfaces (DiagramPropsInterfaces), and duplicating or deleting them. A note is
     text attached to an element: no count, no copy, no interfaces. Each change is one edit of the source. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import type { Model } from "./diagram-edit.ts";
  import { ICONS, type IconName } from "./diagram-icons.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import type { ElementChange, ElementKind } from "./diagram-props-tam.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsArrange from "./DiagramPropsArrange.svelte";
  import DiagramPropsChoice from "./DiagramPropsChoice.svelte";
  import DiagramPropsGeometry from "./DiagramPropsGeometry.svelte";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsInterfaces from "./DiagramPropsInterfaces.svelte";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";
  import DiagramPropsSegments from "./DiagramPropsSegments.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ws, P, m, ids }: { ws: Workbench; P: Kit; m: Model; ids: string[] } = $props();
  const ed = $derived(ws.ed);
  const layout = $derived(ws.layout);

  /** The series color each named color is drawn in (src/tam/draw.ts SERIES, lib/diagrams.ts `colors`). */
  const SWATCH: Record<string, string> = {
    blue: "var(--ansi-4)",
    orange: "var(--ansi-3)",
    green: "var(--ansi-2)",
    yellow: "var(--ansi-11)",
    pink: "var(--ansi-13)",
    purple: "var(--ansi-5)",
    red: "var(--ansi-1)",
    gray: "color-mix(in srgb, var(--d-text) 55%, var(--d-panel))",
  };
  const COUNTS = [
    { value: "one", name: "One" },
    { value: "stack", name: "Stack", tip: "Several, drawn as a stack" },
    { value: "several", name: "A … B", tip: "Several, drawn as two with dots between" },
  ] as const;
  const SIDES = [
    { value: "beside", name: "Beside", tip: "A … B, side by side" },
    { value: "below", name: "Below", tip: "A … B, one above the other" },
  ] as const;

  const diagram = $derived(m.diagram);
  const one = $derived(ids.length === 1 ? diagram.nodes.get(ids[0]!) : undefined);
  const notes = $derived(ids.every((id) => diagram.nodes.get(id)?.kind === "note"));
  const kind = $derived(P.shared(diagram, ids, (node) => node.kind));
  const kinds = $derived(
    P.elementKinds(m.source, ids, kind).map((k) => ({ value: k, name: P.kindName(k) })),
  );
  const color = $derived(P.shared(diagram, ids, (node) => node.color ?? ""));
  const count = $derived(P.shared(diagram, ids, (node) => P.countOf(diagram, node)));
  const boxes = $derived(new Map(m.scene.shapes.map((shape) => [shape.id, shape.box])));
  const copied = $derived(one && diagram.nodes.has(`${one.id}#2`));

  const set = (change: ElementChange) =>
    ed.apply((model) => P.elementsWith(model.source, ids, change));
  const reid = (id: string, next: string) => {
    const done = ed.apply((model) => P.idRenamed(model.source, id, next));
    if (done) ed.selection = [{ type: "element", id: next.trim() }];
    return done;
  };
  const placeCopy = (id: string, side: "beside" | "below") => {
    const box = boxes.get(id);
    return !!box && ed.apply((model, edits) => P.copyPlaced(edits.placed(model), id, box, side));
  };
  const subjectIcon = (k: string | undefined) =>
    k && k in ICONS ? ICONS[k as IconName] : ICONS.agent;
</script>

{#if ids.length !== 1}
  <DiagramPropsSubject icon={ICONS.shapes} title="{ids.length} elements" />
{:else if notes}
  <DiagramPropsSubject icon={ICONS["uml-note"]} title="Note" />
{:else}
  <DiagramPropsSubject icon={subjectIcon(one?.kind)} title="Element" />
{/if}

<DiagramPropsGroup title="Identity" {layout}>
  {#if one}
    {#key one.id}
      <DiagramPropsRow label={notes ? "Text" : "Name"}>
        <DiagramPropsText
          multiline
          placeholder={notes ? "Text" : "Name"}
          value={one.label.replace(/<br\s*\/?>/gi, "\n")}
          oncommit={(label) => set({ label })}
        />
      </DiagramPropsRow>
    {/key}
  {/if}
  <DiagramPropsRow label="Kind">
    <DiagramPropsChoice
      options={kinds}
      value={(kind ?? "") as ElementKind | ""}
      onpick={(k) => set({ kind: k })}
    />
  </DiagramPropsRow>
  {#if one}
    {#key one.id}
      <DiagramPropsRow label="Id">
        <DiagramPropsText value={one.id} oncommit={(next) => reid(one.id, next)} />
      </DiagramPropsRow>
    {/key}
  {/if}
</DiagramPropsGroup>

<DiagramPropsGroup title="Style" {layout}>
  <DiagramPropsRow label="Color" tag="div">
    <div class="swatches">
      {#each P.SWATCHES as c (c)}
        <button
          class="swatch"
          class:none={!c}
          type="button"
          aria-pressed={color === c}
          aria-label={P.colorName(c)}
          title={P.colorName(c)}
          style:--swatch={SWATCH[c]}
          onclick={() => set({ color: c || null })}
        ></button>
      {/each}
    </div>
  </DiagramPropsRow>
  {#if !notes}
    <DiagramPropsRow label="Count" tag="div">
      <DiagramPropsSegments
        options={COUNTS}
        value={count}
        refusal={(c) => P.countRefusal(m.source, ids, c)}
        onpick={(c) => set(P.countChange(c))}
      />
    </DiagramPropsRow>
  {/if}
  {#if one && copied}
    <DiagramPropsRow label="Copy" tag="div">
      <DiagramPropsSegments
        options={SIDES}
        value={P.copySide(boxes, one.id)}
        onpick={(side) => placeCopy(one.id, side)}
      />
    </DiagramPropsRow>
  {/if}
</DiagramPropsGroup>

{#if one}
  <DiagramPropsGeometry {ed} {layout} {P} id={one.id} />
{/if}
<DiagramPropsArrange {ws} {P} {m} {ids} />
{#if one && !notes}
  <DiagramPropsInterfaces {ws} {P} {m} id={one.id} />
{/if}

<div class="actions end">
  <Button onclick={ed.duplicate}>Duplicate</Button>
  <Button variant="danger" onclick={ed.remove}>Delete</Button>
</div>

<style>
  .swatches {
    display: grid;
    grid-template-columns: repeat(5, 20px);
    gap: var(--space-4);
    padding: var(--space-2) 0;
  }
  .swatch {
    width: 20px;
    height: 20px;
    padding: 0;
    border: var(--border-width) solid rgb(0 0 0 / 15%);
    border-radius: var(--radius-full);
    background: var(--swatch);
    cursor: pointer;
  }
  .swatch[aria-pressed="true"] {
    box-shadow:
      0 0 0 2px var(--d-panel),
      0 0 0 4px var(--d-accent);
  }
  .swatch.none {
    border-color: var(--d-line-strong);
    background: linear-gradient(135deg, transparent 46%, var(--d-danger) 46% 54%, transparent 54%)
      var(--d-field);
  }
  .swatch:focus-visible {
    outline: 2px solid var(--d-accent);
    outline-offset: 1px;
  }
</style>
