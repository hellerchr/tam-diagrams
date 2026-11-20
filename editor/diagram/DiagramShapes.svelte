<!-- The left panel's Shapes tab (DiagramLeft.svelte), tam-diagrams' palette: a field that finds a shape, and the type's
     shapes and kinds of connection (palettes.ts, diagram-shapes.ts) as tiles in folding groups. A block diagram's
     shape is a tool: a click picks it to place with a click on the canvas (again: back to Select), a double click
     keeps it to place several, a drag carries it to the canvas, where it shows as it would stand. A UML piece is added
     at the selected part on a click, or dragged onto a part to join it there. A kind of connection clicked is the one
     new connections are drawn as (and the selected ones become). A type edited as text lists its statements instead,
     a click adding one to the source. -->
<script lang="ts">
  import Icon from "../ui/Icon.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import type { ElementKind } from "./diagram-edit.ts";
  import type { Point } from "./diagram-hit.ts";
  import { snippetsFound, snippetTip, TilePress, tileGroups, tileTip } from "./diagram-shapes.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramFind from "./DiagramFind.svelte";
  import DiagramFold from "./DiagramFold.svelte";
  import { type PaletteItem, paletteOf, snippetIcon } from "./palettes.ts";

  let { ws }: { ws: Workbench } = $props();
  const ed = $derived(ws.ed);

  let query = $state("");
  let shut = $state<Record<string, boolean>>({});
  const kind = $derived(ws.pictures.kind ?? "");
  /** A UML type is pieces joined by its structure; a source that does not read keeps its type's palette. */
  const uml = $derived(kind !== "tam" && kind !== "");
  const palette = $derived(ed.palette ?? (uml ? ed.umlEd.edits?.palette(kind) : paletteOf("tam")));
  const title = $derived(ws.current?.name ?? "Shapes");
  const groups = $derived(palette ? tileGroups(palette, title, uml, query) : []);
  const snippets = $derived(palette ? [] : snippetsFound(ws.current?.snippets ?? [], query));
  const link = $derived(ed.uml ? ed.umlEd.link : ed.link);
  const nothing = $derived(
    !groups.some((group) => !group.links && group.items.length) && !snippets.length,
  );

  // Another type starts the list again: the search empty, every group open.
  $effect(() => {
    void title;
    query = "";
    shut = {};
  });

  /** Why a UML piece cannot be added to the diagram as it stands (a group beside lanes); undefined when it can. */
  const refusal = (piece: string) => ed.uml?.structure.refusal?.(ed.uml.source, piece);

  let pressed: PaletteItem | undefined;
  let clicked = -1000;
  let chip = $state.raw<{ item: PaletteItem; at: Point; hidden: boolean }>();

  const over = (client: Point) => {
    const r = ws.stage?.getBoundingClientRect();
    return (
      !!r && client.x >= r.left && client.x <= r.right && client.y >= r.top && client.y <= r.bottom
    );
  };
  const scene = (client: Point) => ws.at({ clientX: client.x, clientY: client.y });

  const press = new TilePress(
    {
      // Over the canvas a shape shows where it would stand; on the way there, as a chip.
      move: (client, on, e) => {
        const item = pressed!;
        chip = { item, at: client, hidden: on && !uml };
        if (uml) ws.dragShape(item.kind, client, false);
        else ws.showGhost(item.kind as ElementKind, on ? scene(client) : undefined, e.altKey);
      },
      release: (dragged, on, e) => {
        const item = pressed!;
        if (uml)
          return dragged
            ? ws.dragShape(item.kind, { x: e.clientX, y: e.clientY }, true)
            : ws.addShape(item.kind);
        // A second click soon after the first keeps the tool, to place several.
        const again = e.timeStamp - clicked < 400;
        clicked = e.timeStamp;
        if (dragged) {
          if (on)
            ws.create(
              item.kind as ElementKind,
              scene({ x: e.clientX, y: e.clientY }),
              e.altKey,
              ws.sticky,
            );
        } else if (again) ws.pickTool(item.kind as ElementKind, true);
        else toggleTool(item.kind);
      },
      end: () => {
        chip = undefined;
        ws.showGhost();
        ws.g.hover = undefined;
      },
    },
    over,
  );

  const toggleTool = (shape: string) =>
    ws.pickTool(ws.tool === shape ? "select" : (shape as ElementKind));

  function down(e: PointerEvent, item: PaletteItem, off: boolean) {
    if (off) return;
    pressed = item;
    press.down(e);
  }

  /** The keyboard picks a shape as the pointer does. */
  function keyed(e: MouseEvent, item: PaletteItem, off: boolean) {
    if (e.detail !== 0 || off) return;
    if (uml) ws.addShape(item.kind);
    else toggleTool(item.kind);
  }

  function pickLink(kind: string) {
    const again = link === kind;
    ed.pickLink(kind);
    if (!ed.uml) ws.pickTool(again ? "select" : "connect");
  }
</script>

<DiagramFind bind:value={query} label="Find a shape" />
<div class="palette">
  {#each groups as group (group.title)}
    <section>
      <DiagramFold
        title={group.title}
        open={!shut[group.title]}
        ontoggle={() => (shut[group.title] = !shut[group.title])}
      />
      {#if !shut[group.title]}
        <div class="tiles">
          {#each group.items as item (item.kind)}
            {#if group.links}
              <button
                class="tile"
                type="button"
                aria-pressed={item.kind === link}
                title={tileTip(item, { links: true, uml })}
                onclick={() => pickLink(item.kind)}
              >
                <Icon icon={item.icon} size={24} /><span class="name">{item.name}</span>
              </button>
            {:else}
              {@const off = uml ? refusal(item.kind) : undefined}
              <button
                class="tile"
                class:sticky={ws.tool === item.kind && ws.sticky}
                type="button"
                aria-pressed={!uml && ws.tool === item.kind}
                aria-disabled={off ? "true" : undefined}
                title={off ? `${off}.` : tileTip(item, { links: false, uml })}
                onpointerdown={(e) => down(e, item, !!off)}
                onpointermove={(e) => press.move(e)}
                onpointerup={(e) => press.up(e)}
                onpointercancel={() => press.cancel()}
                onclick={(e) => keyed(e, item, !!off)}
              >
                <Icon icon={item.icon} size={24} /><span class="name">{item.name}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}
  {#if snippets.length}
    <section>
      <DiagramFold {title} open={!shut[title]} ontoggle={() => (shut[title] = !shut[title])} />
      {#if !shut[title]}
        <div class="tiles">
          {#each snippets as snippet (snippet.name)}
            <button
              class="tile snippet"
              type="button"
              title={snippetTip(snippet)}
              onclick={() => ed.addStatements(snippet.text)}
            >
              <Icon icon={snippetIcon(snippet.name)} size={24} /><span class="name"
                >{snippet.name}</span
              >
            </button>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
  {#if nothing}<p class="note">Nothing found.</p>{/if}
</div>

{#if chip && !chip.hidden}
  <div class="drag-chip" style:transform="translate({chip.at.x + 10}px, {chip.at.y + 10}px)">
    <Icon icon={chip.item.icon} size={16} /><span>{chip.item.name}</span>
  </div>
{/if}

<style>
  .palette {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--space-5);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  section {
    padding: var(--space-2) var(--space-3) 0;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    align-items: start;
    gap: var(--space-1);
    padding: var(--space-2) 0 var(--space-4);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    min-height: 56px;
    padding: var(--space-4) var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    line-height: 13px;
    text-align: center;
    cursor: grab;
    touch-action: none;
  }
  .tile:hover {
    background: var(--d-hover);
    box-shadow: inset 0 0 0 var(--border-width) var(--d-line);
  }
  .tile[aria-pressed="true"] {
    background: var(--d-accent-soft);
    color: var(--d-accent-text);
  }
  .tile.sticky {
    box-shadow: inset 0 0 0 var(--border-width) var(--d-accent);
  }
  .tile[aria-disabled="true"],
  .tile[aria-disabled="true"]:hover {
    background: none;
    box-shadow: none;
    color: var(--d-text-3);
    cursor: default;
  }
  .tile.snippet {
    cursor: pointer;
  }
  .tile:focus-visible {
    outline: var(--rule-width) solid var(--d-accent);
    outline-offset: 1px;
  }
  .note {
    margin: 0;
    padding: var(--space-2) var(--space-5);
    color: var(--d-text-2);
  }
  .drag-chip {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--control-md);
    padding: 0 var(--space-4);
    border: var(--border-width) solid var(--d-accent);
    border-radius: var(--radius-sm);
    background: var(--d-raised);
    box-shadow: var(--shadow-popover);
    color: var(--d-accent-text);
    pointer-events: none;
  }
</style>
