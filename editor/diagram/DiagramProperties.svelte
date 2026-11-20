<!-- The Properties section of the diagram editor's right panel (DiagramSide.svelte), as tam-diagrams' old inspector had
     it: what is selected, an icon and a name above groups that fold by their titles (Identity, Layout, Style,
     Geometry, Arrange, …), each a row with its label in a 64 px column, and the pane's actions at the end. What shows
     follows the selection: nothing, the diagram's own settings (DiagramPropsDiagram); a block diagram's elements
     (DiagramPropsElements) or one connection (DiagramPropsWire); a UML diagram's part (DiagramPropsPart) or join
     (DiagramPropsJoin); elements and connections together, only their removal. Every change is one edit of the source,
     through the editor's commands, so undo, save and agents' edits work. -->
<script lang="ts" module>
  import type { Kit } from "./diagram-props-kit.ts";

  let loading: Promise<Kit> | undefined;
  /** Loads the panel's modules, as one object. */
  const loadKit = () =>
    Promise.all([
      import("./diagram-props.ts"),
      import("./diagram-props-layout.ts"),
      import("./diagram-props-tam.ts"),
      import("./diagram-props-uml.ts"),
    ]).then((modules) => Object.assign({}, ...modules) as Kit);
</script>

<script lang="ts">
  import Button from "../ui/Button.svelte";
  import type { Model } from "./diagram-edit.ts";
  import { ICONS } from "./diagram-icons.ts";
  import type { UmlModel } from "./diagram-uml-model.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsDiagram from "./DiagramPropsDiagram.svelte";
  import DiagramPropsElements from "./DiagramPropsElements.svelte";
  import DiagramPropsJoin from "./DiagramPropsJoin.svelte";
  import DiagramPropsPart from "./DiagramPropsPart.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsWire from "./DiagramPropsWire.svelte";

  let { ws }: { ws: Workbench } = $props();
  const ed = $derived(ws.ed);

  let P = $state.raw<Kit>();
  void (loading ??= loadKit()).then((kit) => (P = kit));

  // The diagram, kept while the picture of an edit is on its way (or while the source does not read), so the pane
  // stays as it is meanwhile; a file of the other notation drops it.
  let keptTam: Model | undefined;
  let keptUml: UmlModel | undefined;
  const tam = $derived.by(
    () => (keptTam = ws.notation === "tam" ? (ed.model ?? keptTam) : undefined),
  );
  const uml = $derived.by(
    () => (keptUml = ws.notation === "tam" ? undefined : (ed.uml ?? keptUml)),
  );
  const elements = $derived(ed.selection.filter((p) => p.type === "element").map((p) => p.id));
  const wires = $derived(ed.selection.filter((p) => p.type === "wire").map((p) => p.id));
  const count = $derived(ed.selection.length);
</script>

{#snippet remove()}
  <div class="actions end"><Button variant="danger" onclick={ed.remove}>Delete</Button></div>
{/snippet}

<div class="inspector">
  {#if !P}
    <!-- The panel's module is on its way: a frame or two. -->
  {:else if uml}
    {#if elements.length === 1 && !wires.length}
      <DiagramPropsPart {ws} {P} m={uml} id={elements[0]!} />
    {:else if wires.length === 1 && !elements.length}
      <DiagramPropsJoin {ws} {P} m={uml} id={wires[0]!} />
    {:else if count}
      <DiagramPropsSubject icon={ICONS.shapes} title="{count} selected" />
      {@render remove()}
    {:else}
      <DiagramPropsDiagram {ws} {P} structural />
    {/if}
  {:else if tam && count}
    {#if wires.length === 1 && !elements.length}
      <DiagramPropsWire {ws} {P} m={tam} id={wires[0]!} />
    {:else if elements.length && !wires.length}
      <DiagramPropsElements {ws} {P} m={tam} ids={elements} />
    {:else}
      <DiagramPropsSubject icon={ICONS.shapes} title="{count} selected" />
      <p class="note">
        Elements and connections are selected together. Select only elements, or one connection, to
        see properties.
      </p>
      {@render remove()}
    {/if}
  {:else}
    <DiagramPropsDiagram {ws} {P} />
  {/if}
</div>

<style>
  .inspector {
    height: 100%;
    min-height: 0;
    overflow: hidden auto;
    scrollbar-width: thin;
    scrollbar-color: var(--d-line-strong) transparent;
  }
  .inspector :global(.note) {
    margin: 0;
    padding: 0 var(--space-5) var(--space-4);
    color: var(--d-text-2);
  }
  .inspector :global(.actions) {
    display: flex;
    gap: var(--space-4);
  }
  .inspector :global(.actions.end) {
    padding: var(--space-5);
    border-top: var(--border-width) solid var(--d-line);
  }
  .inspector :global(textarea.field) {
    display: block;
    height: auto;
    min-height: var(--d-control);
    padding: 5px var(--space-4);
    line-height: 16px;
    resize: none;
    overflow: hidden;
  }
  .inspector :global(select.field) {
    padding: 0 var(--space-2);
  }
  .inspector :global(code.id) {
    overflow: hidden;
    font-size: var(--text-xs);
    color: var(--d-text-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
