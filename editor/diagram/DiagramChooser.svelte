<!-- The chooser of a new diagram (DiagramView.svelte; File > New, the bar's type chip, Ctrl+Alt+N), as the old
     editor's dialogs.ts had it: a card for each type the file may hold, with a small picture of it, and below the cards
     what to start from (a new diagram, the sample, the type's examples from src/tam/examples.ts) beside a picture of
     the one picked. The arrow keys go through the cards and through the list; Enter or a double click creates, which
     puts the new diagram in place of the one on show (Undo brings it back). The pictures are drawn by renderDiagram,
     which keeps them. -->
<script lang="ts">
  import { TriangleAlert } from "lucide";
  import type { EXAMPLES } from "../../src/examples.ts";
  import { renderDiagram } from "../lib/diagrams.ts";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import {
    badgeOf,
    cardStep,
    fills,
    type Start,
    startStep,
    startsOf,
    thumbOf,
    typeIcon,
  } from "./diagram-chooser.ts";
  import { ICONS } from "./diagram-icons.ts";
  import type { DiagramType } from "./diagram-types.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramDialog from "./DiagramDialog.svelte";

  let {
    ws,
    dirty = false,
    onclose,
  }: { ws: Workbench; dirty?: boolean; onclose: () => void } = $props();

  const types = $derived(ws.types);
  let chosen = $state.raw<DiagramType>();
  const type = $derived(chosen ?? types.find((t) => t === ws.current) ?? types[0]!);
  let examples = $state.raw<typeof EXAMPLES>();
  void import("../../src/examples.ts").then((module) => (examples = module.EXAMPLES));
  const starts = $derived(startsOf(type, examples?.[type.kind as keyof typeof EXAMPLES] ?? []));
  let picked = $state(0);
  const start = $derived<Start | undefined>(starts[picked]);

  const langOf = (t: DiagramType) => (t.kind === "tam" ? "tam" : "mermaid");

  /** The pictures on the cards, by kind: each a data URL, and whether it fills its window. */
  let thumbs = $state<Record<string, { url: string; fill: boolean }>>({});
  $effect(() => {
    for (const t of types)
      void renderDiagram(thumbOf(t), langOf(t)).then((drawn) => {
        if (drawn) thumbs[t.kind] = { url: drawn.url, fill: fills(drawn.width, drawn.height) };
      });
  });

  /** The picture of the start picked; a drawing asked for before another is dropped. */
  let preview = $state<{ url?: string; note: string }>({ note: "" });
  let turn = 0;
  $effect(() => {
    const source = start?.source ?? "";
    const mine = ++turn;
    preview = { note: source.trim() ? "" : "An empty canvas" };
    if (source.trim())
      void renderDiagram(source, langOf(type)).then((drawn) => {
        if (mine === turn)
          preview = drawn ? { url: drawn.url, note: "" } : { note: "No picture of this one" };
      });
  });

  function pick(next: DiagramType) {
    chosen = next;
    picked = 0;
    list?.scrollTo(0, 0);
  }

  function create() {
    onclose();
    ws.replace(start?.source ?? "");
  }

  let deck = $state<HTMLElement>();
  let list = $state<HTMLElement>();

  /** The arrow keys go through the cards (as many as the first row has make a step up or down); Enter creates. */
  function deckKey(event: KeyboardEvent) {
    if (event.key === "Enter") return (event.preventDefault(), create());
    const cards = [...(deck?.querySelectorAll<HTMLElement>(".card") ?? [])];
    const across = cards.filter((card) => card.offsetTop === cards[0]?.offsetTop).length;
    const next = cardStep(event.key, types.indexOf(type), across, types.length);
    if (next === undefined) return;
    event.preventDefault();
    pick(types[next]!);
    cards[next]?.focus();
  }

  /** The arrow keys, Home and End go through the list of starts; Enter creates. */
  function listKey(event: KeyboardEvent) {
    if (event.key === "Enter") return (event.preventDefault(), create());
    const next = startStep(event.key, picked, starts.length);
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  }

  function choose(at: number) {
    picked = at;
    const row = list?.children[at] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
    row?.focus();
  }
</script>

<DiagramDialog title="New diagram" width={760} {onclose}>
  <div
    class="cards"
    role="radiogroup"
    aria-label="Diagram type"
    tabindex="-1"
    bind:this={deck}
    onkeydown={deckKey}
  >
    {#each types as each (each.kind)}
      {@const thumb = thumbs[each.kind]}
      <button
        class="card"
        role="radio"
        aria-checked={each === type}
        tabindex={each === type ? 0 : -1}
        title={each.about}
        data-autofocus={each === type || undefined}
        onclick={() => pick(each)}
        ondblclick={create}
      >
        <span class="thumb"
          >{#if thumb}<img
              src={thumb.url}
              alt=""
              draggable="false"
              class:whole={!thumb.fill}
            />{/if}</span
        >
        <span class="name"><Icon icon={ICONS[typeIcon(each.kind)]} size={16} />{each.name}</span>
        <span class="badge">{badgeOf(each)}</span>
      </button>
    {/each}
  </div>
  <h2 class="from">Start from</h2>
  <div class="row">
    <div
      class="starts"
      role="listbox"
      aria-label="Start from"
      tabindex="-1"
      bind:this={list}
      onkeydown={listKey}
    >
      {#each starts as each, i (each.source)}
        <!-- svelte-ignore a11y_click_events_have_key_events (the list's keys go through it) -->
        <div
          class="start"
          role="option"
          aria-selected={i === picked}
          tabindex={i === picked ? 0 : -1}
          title={each.name.length > 40 ? each.name : undefined}
          onclick={() => choose(i)}
          ondblclick={create}
        >
          <Icon icon={ICONS[each.icon]} size={16} />
          <span class="label">{each.name}</span>
        </div>
      {/each}
    </div>
    <div class="preview">
      {#if preview.url}<img src={preview.url} alt="" draggable="false" />{/if}
      {#if preview.note}<span class="note">{preview.note}</span>{/if}
    </div>
  </div>
  {#snippet footer()}
    {#if dirty}
      <span class="note foot warning"
        ><Icon icon={TriangleAlert} size={16} /><span
          >The diagram on show has unsaved changes. Undo brings it back.</span
        ></span
      >
    {:else}
      <span class="note foot"
        >The new diagram takes the place of the one on show. Undo brings it back.</span
      >
    {/if}
    <Button onclick={onclose}>Cancel</Button>
    <Button variant="primary" onclick={create}>Create</Button>
  {/snippet}
</DiagramDialog>

<style>
  .cards {
    display: grid;
    flex: none;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-4);
    padding: var(--space-6);
    outline: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-4);
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-sm);
    background: var(--c-surface);
    text-align: left;
  }
  .card:hover {
    border-color: color-mix(in srgb, var(--c-border) 70%, var(--c-foreground));
    background: var(--c-hover);
  }
  .card[aria-checked="true"] {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent);
    background: var(--c-accent-soft);
  }
  /* The picture fills the card's window: what does not fit is cut at the sides. */
  .thumb {
    display: block;
    height: 80px;
    margin-bottom: var(--space-2);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--c-canvas);
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    padding: var(--space-2);
    object-fit: cover;
  }
  .thumb img.whole {
    padding: var(--space-3);
    object-fit: contain;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-weight: var(--weight-medium);
  }
  .name > :global(.icon),
  .start > :global(.icon) {
    color: var(--c-muted);
  }
  .badge {
    color: var(--c-muted);
    font-size: var(--text-xs);
  }
  .from {
    padding: 0 var(--space-6) var(--space-3);
  }
  .row {
    display: grid;
    flex: none;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-4);
    height: 172px;
    margin: 0 var(--space-6) var(--space-6);
  }
  .starts,
  .preview {
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-sm);
  }
  .starts {
    padding: var(--space-1);
    overflow-y: auto;
    background: var(--c-input);
    outline: none;
    scrollbar-width: thin;
  }
  .start {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--control-md);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .start:hover {
    background: var(--c-hover);
  }
  .start[aria-selected="true"] {
    background: var(--c-accent-soft);
  }
  .start:focus-visible {
    outline-offset: -2px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
    background: var(--c-canvas);
  }
  .preview img {
    position: absolute;
    inset: var(--space-4);
    width: calc(100% - 2 * var(--space-4));
    height: calc(100% - 2 * var(--space-4));
    object-fit: contain;
  }
  .note {
    color: var(--c-muted);
  }
  .foot {
    flex: 1;
    min-width: 0;
  }
  .note.warning {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--ansi-3);
    font-weight: var(--weight-medium);
  }
  @media (max-width: 560px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
    .preview {
      display: none;
    }
  }
</style>
