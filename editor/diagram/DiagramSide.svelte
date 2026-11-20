<!-- The diagram editor's right panel (DiagramView.svelte, a DiagramPanel), as tam-diagrams' editor had it: the
     Properties section (DiagramProperties.svelte) above the Source section, which shows the file's own source editor
     (`sourcePane`, moved in while the panel shows and given back after), dressed as the old source pane, with the strips
     of a problem over its foot (DiagramSideStrips.svelte). Each section folds by its title (DiagramFold.svelte), and the
     × in the top head closes the panel (the rail's button opens it again); while both show, the splitter between them
     sets the Properties height (each keeps 160px; a double click shares the panel evenly) and the Source's expand
     button gives the source most of the panel. In a tiny window it lies over the canvas. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import Resizer from "../ui/Resizer.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import { RIGHT, SECTION } from "./diagram-layout.svelte.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramFold from "./DiagramFold.svelte";
  import DiagramPanel from "./DiagramPanel.svelte";
  import DiagramPanelHead from "./DiagramPanelHead.svelte";
  import DiagramProperties from "./DiagramProperties.svelte";
  import DiagramSideStrips from "./DiagramSideStrips.svelte";

  type Props = { ws: Workbench; sourcePane?: HTMLElement; over: boolean; onguide?: () => void };
  let { ws, sourcePane, over, onguide }: Props = $props();
  const layout = $derived(ws.layout);

  const both = $derived(layout.properties && layout.source);
  let panel = $state<HTMLElement>();
  let properties = $state<HTMLElement>();

  /** Moves the file's source editor into the Source section, and back where it was when the section goes. */
  function adopt(slot: HTMLElement) {
    if (!sourcePane) return;
    const pane = sourcePane;
    const home = pane.parentElement;
    const next = pane.nextSibling;
    slot.prepend(pane);
    // Its own place hides it while the diagram shows; here it shows.
    pane.style.display = "block";
    return () => {
      pane.style.display = "";
      home?.insertBefore(pane, next);
    };
  }

  /** The source takes most of the panel, or shares it again; asked to take the room, it shows whatever was folded. */
  function expand() {
    layout.wide = !layout.wide;
    if (layout.wide) layout.source = true;
  }
</script>

{#snippet sourceTools()}
  {#if ws.problem}<span class="count">1 problem</span>{/if}
  {#if onguide}
    <Button
      variant="ghost"
      size="sm"
      icon={ICONS.help}
      title="Guide: the rules and the syntax of this diagram (F1)"
      onclick={onguide}
    />
  {/if}
  <Button
    variant="ghost"
    size="sm"
    icon={ICONS.expand}
    active={layout.wide}
    aria-pressed={layout.wide}
    title="Give the source most of the panel"
    onclick={expand}
  />
{/snippet}

<DiagramPanel
  side="right"
  label="Properties and source"
  {over}
  width={layout.rightWidth}
  range={RIGHT}
  onwidth={(w) => (layout.rightWidth = w)}
  bind:element={panel}
>
  <section
    class="section properties"
    class:closed={!layout.properties}
    class:split={both}
    bind:this={properties}
    style:flex={both ? `0 0 ${layout.propertiesHeight}` : undefined}
  >
    <DiagramPanelHead>
      <DiagramFold
        title="Properties"
        open={layout.properties}
        ontoggle={() => (layout.properties = !layout.properties)}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={ICONS.close}
        title="Close the panel"
        onclick={() => (layout.side = false)}
      />
    </DiagramPanelHead>
    {#if layout.properties}<div class="body"><DiagramProperties {ws} /></div>{/if}
  </section>
  {#if both}
    <div class="splitter">
      <Resizer
        axis="y"
        bind:height={() => properties?.offsetHeight ?? 0, (h) => (layout.split = h)}
        side="top"
        min={SECTION}
        max={() => (panel?.clientHeight ?? 2 * SECTION) - SECTION}
        onreset={() => (layout.split = 0)}
      />
    </div>
  {/if}
  <section class="section source" class:closed={!layout.source} class:below={layout.properties}>
    <DiagramPanelHead>
      <DiagramFold
        title="Source"
        open={layout.source}
        ontoggle={() => (layout.source = !layout.source)}
        end={sourceTools}
      />
    </DiagramPanelHead>
    {#if layout.source}
      <div class="body code" {@attach adopt}>
        <DiagramSideStrips {ws} />
      </div>
    {/if}
  </section>
</DiagramPanel>

<style>
  .section {
    position: relative;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 0;
  }
  .section.closed {
    flex: none;
  }
  /* Under the Properties' body; a folded Properties' head has its line already. */
  .source.below {
    border-top: var(--border-width) solid var(--d-line);
  }
  /* Each of the two keeps a few lines, however far the line between them was dragged. */
  .properties.split {
    min-height: min(160px, 50%);
    max-height: calc(100% - 160px);
  }
  .count {
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--d-danger) 14%, transparent);
    color: var(--d-danger);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .splitter {
    position: relative;
    z-index: 3;
    flex: none;
    height: 0;
  }
  /* The source pane as the old editor's: smaller mono text, quiet gutters, no folding; the lines of what is selected on
     the canvas marked in the accent. */
  .code {
    position: relative;
    display: flex;
    background: var(--d-field);
  }
  .code > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
  .code :global(.cm-editor) {
    background: var(--d-field);
    font-size: calc(var(--text-code) - 1px);
  }
  .code :global(.cm-editor .cm-scroller) {
    font-variant-ligatures: none;
    line-height: 1.55;
    scrollbar-width: thin;
  }
  .code :global(.cm-editor .cm-content) {
    padding-bottom: var(--space-8);
  }
  .code :global(.cm-editor .cm-gutters) {
    background: transparent;
    color: var(--d-text-3);
    border: none;
  }
  .code :global(.cm-editor .cm-lineNumbers .cm-gutterElement) {
    min-width: 20px;
    padding: 0 3px 0 5px;
  }
  /* CodeMirror's own theme shows every gutter with !important; the old pane had only the line numbers (a problem shows
     in its strip). */
  .code :global(.cm-editor .cm-foldGutter),
  .code :global(.cm-editor .cm-gutter-lint) {
    display: none !important;
  }
  .code :global(.cm-editor .cm-activeLine) {
    background: color-mix(in srgb, var(--d-text) 5%, transparent);
  }
  .code :global(.cm-editor .cm-activeLineGutter) {
    background: transparent;
  }
  .code :global(.cm-editor .cm-diagram-selected) {
    background: var(--d-accent-soft);
  }
</style>
