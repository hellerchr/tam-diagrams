<!-- The left panel's Outline tab (DiagramLeft.svelte), as the old editor's outline.ts: the diagram's elements as a tree
     (a block diagram's, or a UML diagram's parts), each under what holds it. The arrow opens and closes an element
     that holds others (with Alt all inside it), a click selects (Shift or Cmd/Ctrl adds or takes out) and shows it, a
     double click names it, a right click opens the selection's menu, a drag puts an element (with the rest of the
     selection) inside another, or onto the free space out at the top. The tree is one stop for Tab: the arrow keys go
     from row to row and select. What is selected on the canvas opens around it and comes into view. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { isMac } from "../lib/hotkeys.svelte.ts";
  import { addsToSelection } from "../lib/keyspec.ts";
  import Button from "../ui/Button.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import { openContextMenu } from "./diagram-menus.ts";
  import { lookOf, searchTexts } from "./diagram-outline-look.ts";
  import { around, parentsIn, type TreeRow, treeRows, within } from "./diagram-outline.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramFind from "./DiagramFind.svelte";
  import DiagramOutlineRow from "./DiagramOutlineRow.svelte";

  let { ws }: { ws: Workbench } = $props();
  const ed = $derived(ws.ed);

  let filter = $state("");
  let folded = $state(new Set<string>());
  let tree = $state<HTMLElement>();
  /** The row the keyboard was on last: the tree's stop for Tab when nothing in it is selected. */
  let focused = $state<string>();

  const structure = $derived(ed.uml?.structure);
  const items = $derived(ed.tree);
  const look = $derived((item: TreeRow["item"]) => lookOf(item, structure));
  const rows = $derived(treeRows(items, folded, filter, (item) => searchTexts(item, look(item))));
  const selected = $derived(ed.selectedIds());
  const flat = $derived(!items.some((item) => item.children.length));
  const stop = $derived(
    [selected.at(-1), focused].find((id) => id && rows.some((row) => row.item.id === id)) ??
      rows[0]?.item.id,
  );
  const empty = $derived(
    filter.trim()
      ? "Nothing found."
      : ws.textual
        ? `${ws.current?.name ?? "Diagram"}s are edited as text: their parts are in the source.`
        : "No elements yet.",
  );

  // What is selected on the canvas shows in the tree: the elements around it open, the last one comes into view.
  $effect(() => {
    const ids = selected;
    untrack(() => {
      const opening = around(items, ids);
      if (opening.some((id) => folded.has(id)))
        folded = new Set([...folded].filter((id) => !opening.includes(id)));
    });
    const last = ids.at(-1);
    queueMicrotask(() => rowEl(last)?.scrollIntoView({ block: "nearest" }));
  });

  const rowEl = (id: string | undefined) =>
    id ? tree?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : undefined;

  function foldAll(closed: boolean) {
    folded = new Set(closed ? parentsIn(items) : []);
  }

  /** Opens or closes a row's element, with `deep` all inside it too. */
  function toggle(row: TreeRow, deep: boolean) {
    const next = new Set(folded);
    for (const id of deep ? within(row.item) : [row.item.id])
      if (row.folded) next.delete(id);
      else next.add(id);
    folded = next;
  }

  /** Selects a row's element (`adding`: adds it or takes it out), shows it and puts the keyboard on its row. */
  function choose(id: string, adding: boolean) {
    const part = { type: "element" as const, id };
    if (!adding) ed.selection = [part];
    else if (ed.isSelected(part)) ed.selection = ed.selection.filter((other) => other.id !== id);
    else ed.selection = [...ed.selection, part];
    ws.reveal(id);
    focused = id;
    queueMicrotask(() => rowEl(id)?.focus());
  }

  /** The keys of a row: the arrows go along the tree and open and close, the others act on the element. */
  function pressed(row: TreeRow, e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = rows.indexOf(row);
    const id = row.item.id;
    const go = (to: TreeRow | undefined) => to && choose(to.item.id, false);
    const chosen = () => ed.isSelected({ type: "element", id }) || choose(id, false);
    const keys: Record<string, (() => unknown) | false> = {
      ArrowRight: row.parent && row.folded && (() => toggle(row, false)),
      ArrowLeft: row.parent && !row.folded && (() => toggle(row, false)),
      ArrowDown: () => go(rows[at + 1]),
      ArrowUp: () => go(rows[at - 1]),
      Home: () => go(rows[0]),
      End: () => go(rows.at(-1)),
      " ": chosen,
      Enter: () => (chosen(), ws.startRename({ type: "element", id })),
      F2: () => (chosen(), ws.startRename({ type: "element", id })),
      Delete: () => (chosen(), ed.remove()),
      Backspace: () => (chosen(), ed.remove()),
    };
    const act = keys[e.key];
    if (!act) return;
    act();
    e.preventDefault();
    e.stopPropagation();
  }

  function menu(e: MouseEvent, id: string) {
    e.preventDefault();
    if (!ed.isSelected({ type: "element", id })) ed.selection = [{ type: "element", id }];
    openContextMenu(ws, e);
  }

  // A row dragged onto another puts its element, or the selection, inside that one; onto the free space, at the top.
  let dragged: string[] = [];
  let allowed = new Map<string | null, boolean>();
  let target = $state<string | null>();

  function dragStart(e: DragEvent, id: string) {
    if ((e.target as HTMLElement).closest?.(".twist")) return e.preventDefault();
    dragged = selected.includes(id) ? selected : [id];
    allowed = new Map();
    e.dataTransfer?.setData("text/plain", dragged.join(" "));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function takes(id: string | null) {
    if (!dragged.length) return false;
    if (!allowed.has(id)) allowed.set(id, ed.allowsMove(dragged, id));
    return allowed.get(id)!;
  }
  function dragOver(e: DragEvent, id: string | null) {
    if (id === null && e.target !== tree) return;
    if (!takes(id)) return;
    e.preventDefault();
    target = id;
  }
  function drop(e: DragEvent, id: string | null) {
    if (id === null && e.target !== tree) return;
    e.preventDefault();
    const ids = dragged;
    target = undefined;
    if (id) folded = new Set([...folded].filter((other) => other !== id));
    if (ids.length) ed.nest(ids, id);
  }
  function dragEnd() {
    dragged = [];
    target = undefined;
  }
</script>

<DiagramFind bind:value={filter} label="Find an element">
  <Button
    variant="ghost"
    size="sm"
    icon={ICONS.expand}
    title="Expand all"
    onclick={() => foldAll(false)}
  />
  <Button
    variant="ghost"
    size="sm"
    icon={ICONS.collapse}
    title="Collapse all"
    onclick={() => foldAll(true)}
  />
</DiagramFind>
<div
  class="tree"
  class:flat
  role="tree"
  aria-label="Elements"
  tabindex="-1"
  bind:this={tree}
  ondragover={(e) => dragOver(e, null)}
  ondrop={(e) => drop(e, null)}
  ondragend={dragEnd}
>
  {#each rows as row (row.item.id)}
    {@const shown = look(row.item)}
    <DiagramOutlineRow
      {row}
      look={shown}
      selected={selected.includes(row.item.id)}
      over={target === row.item.id}
      stop={stop === row.item.id}
      ontoggle={(deep) => toggle(row, deep)}
      onclick={(e) => choose(row.item.id, addsToSelection(e, isMac))}
      ondblclick={() => ws.startRename({ type: "element", id: row.item.id })}
      oncontextmenu={(e) => menu(e, row.item.id)}
      onkeydown={(e) => pressed(row, e)}
      onfocus={() => (focused = row.item.id)}
      ondragstart={(e) => dragStart(e, row.item.id)}
      ondragover={(e) => dragOver(e, row.item.id)}
      ondragleave={() => target === row.item.id && (target = undefined)}
      ondrop={(e) => drop(e, row.item.id)}
    />
  {:else}
    <p class="note">{empty}</p>
  {/each}
</div>

<style>
  .tree {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--space-7);
    overflow: auto;
    outline: none;
    scrollbar-width: thin;
  }
  .note {
    margin: 0;
    padding: var(--space-2) var(--space-5);
    color: var(--d-text-2);
  }
</style>
