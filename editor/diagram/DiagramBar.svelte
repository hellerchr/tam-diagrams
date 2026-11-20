<!-- The diagram editor's bar (DiagramView.svelte), as in tam-diagrams' editor: the logo and the menu bar (File, Edit,
     View, Arrange, Help: diagram-bar-menus.ts) on the left; the diagram's title (DiagramBarTitle.svelte), the unsaved
     dot and the type's chip (a new diagram) in the middle; undo, redo, Export with its menu and the
     Keyboard and mouse help on the right. A press on a title opens its menu, a press again closes it; with one menu
     open the pointer opens the others as it passes, and the arrows go along the bar. The window's keys
     (diagram-bar-keys.ts): F10 or Alt alone puts the focus on the bar, Alt and a menu's underlined letter opens it. -->
<script lang="ts">
  import { closeMenu, openMenu } from "../lib/overlays.svelte.ts";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import MenuButton from "../ui/MenuButton.svelte";
  import { barKeys } from "./diagram-bar-keys.ts";
  import { barMenus, exportItems, warmExamples } from "./diagram-bar-menus.ts";
  import { keys } from "./diagram-bar-view.ts";
  import { typeIcon } from "./diagram-chooser.ts";
  import { ICONS } from "./diagram-icons.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramBarTitle from "./DiagramBarTitle.svelte";

  type Props = {
    ws: Workbench;
    canUndo?: boolean;
    canRedo?: boolean;
    dirty?: boolean;
    onguide?: (page?: "all") => void;
  };
  let { ws, canUndo, canRedo, dirty, onguide }: Props = $props();

  const menus = $derived(barMenus({ ws, canUndo, canRedo, onguide }));
  /** The bar's menu that is open, by title. */
  let open = $state<string>();
  /** The Export button's menu is open. */
  let exporting = $state(false);
  /** Alt is held alone: the menus' letters are underlined. */
  let alt = $state(false);
  let bar = $state<HTMLElement>();
  const titles = $state<HTMLButtonElement[]>([]);
  /** Set while one menu of the bar takes the place of another: the bar is not left then. */
  let switching = false;
  /** What had the focus before the keyboard went to the bar: it gets it back. */
  let origin: HTMLElement | undefined;

  /** The title `by` steps along the bar from `index`, past those that are off. */
  function along(index: number, by: number) {
    const on = menus.flatMap((menu, i) => (menu.off ? [] : [i]));
    return on[(on.indexOf(index) + by + on.length) % on.length] ?? index;
  }

  function show(index: number, first = false) {
    const menu = menus[index];
    if (!menu || menu.off || !titles[index]) return;
    switching = true;
    openMenu(titles[index], menu.items(), {
      right: false,
      first,
      step: (by) => show(along(index, by), true),
      over: passing,
      closed: () => {
        if (open === menu.title) open = undefined;
        if (!switching) leaveBar();
      },
    });
    open = menu.title;
    switching = false;
  }

  /** With one menu open, the pointer passing over another title opens it. */
  function passing(e: PointerEvent) {
    const index = titles.findIndex((title) => {
      const r = title.getBoundingClientRect();
      return (
        e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
      );
    });
    if (index >= 0 && menus[index]?.title !== open) show(index);
  }

  /** Gives the focus back to what had it before the keyboard went to the bar, if the bar still has it. */
  function leaveBar() {
    const back = origin;
    origin = undefined;
    const active = document.activeElement;
    const onBar =
      !active ||
      active === document.body ||
      titles.includes(active as HTMLButtonElement) ||
      !!active.closest('[role="menu"]');
    if (!back || !onBar) return;
    (back.isConnected && back !== document.body ? back : ws.stage)?.focus({ preventScroll: true });
  }

  function focusBar() {
    const active = document.activeElement as HTMLElement | null;
    if (open || exporting) return closeMenu();
    if (titles.includes(active as HTMLButtonElement)) return leaveBar();
    origin = active ?? undefined;
    titles[along(-1, 1)]?.focus();
  }

  function titleKey(e: KeyboardEvent, index: number) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight")
      titles[along(index, e.key === "ArrowLeft" ? -1 : 1)]?.focus();
    else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") show(index, true);
    else if (e.key === "Escape") leaveBar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const windowKeys = barKeys({
    shell: () => bar?.parentElement,
    barMenuOpen: () => !!open || exporting,
    mnemonic: (letter) => {
      const index = menus.findIndex((menu) => menu.title[0]?.toLowerCase() === letter);
      const menu = menus[index];
      if (!menu || menu.off) return false;
      if (!open) origin = (document.activeElement as HTMLElement | null) ?? undefined;
      if (open !== menu.title) show(index, true);
      return true;
    },
    focusBar,
    alt: (held) => (alt = held),
    newDiagram: () => ws.newDiagram(),
    help: () => ws.toggleHelp(),
    zoomStep: (inward) => ws.zoomStep(inward),
    zoomTo: (zoom) => ws.zoomTo(zoom),
    fit: () => ws.fit(),
    fitSelection: () => ws.fitSelection(),
  });

  // The examples (File > Open example) load once the window is idle, so the menu has them when it opens.
  $effect(() => {
    const idle = requestIdleCallback(warmExamples, { timeout: 2000 });
    return () => cancelIdleCallback(idle);
  });
</script>

<svelte:window
  onkeydowncapture={windowKeys.keydown}
  onkeyupcapture={windowKeys.keyup}
  onpointerdowncapture={windowKeys.released}
  onblur={windowKeys.released}
/>

<header class="bar" class:alt class:narrow={ws.layout.narrow} bind:this={bar}>
  <div class="start">
    <span class="logo" title="Diagram editor"><Icon icon={ICONS.logo} size={20} /></span>
    <nav class="menubar" aria-label="Menus">
      {#each menus as menu, index (menu.title)}
        <button
          class="menu-title"
          bind:this={titles[index]}
          aria-haspopup="menu"
          aria-expanded={open === menu.title}
          aria-disabled={menu.off ? true : undefined}
          aria-keyshortcuts="Alt+{menu.title[0]}"
          title={menu.off}
          onpointerdown={(e) => e.button === 0 && (e.preventDefault(), show(index))}
          onclick={(e) => e.detail === 0 && show(index, true)}
          onkeydown={(e) => titleKey(e, index)}
        >
          <u>{menu.title[0]}</u>{menu.title.slice(1)}
        </button>
      {/each}
    </nav>
  </div>
  <div class="doc">
    <DiagramBarTitle {ws} />
    {#if dirty}<span class="unsaved" title="Unsaved changes"></span>{/if}
    <button
      class="chip"
      title="{ws.current?.about ?? 'The diagram\u2019s type'}. Click for a new diagram."
      onclick={ws.newDiagram}
    >
      {#if ws.current}<Icon icon={ICONS[typeIcon(ws.current.kind)]} size={16} />{/if}
      {#if ws.layout.width >= 720}<span>{ws.current?.name ?? "Diagram"}</span>{/if}
      <Icon icon={ICONS.chevron} size={12} />
    </button>
  </div>
  <div class="end">
    <Button
      variant="ghost"
      icon={ICONS.undo}
      title="Undo ({keys('Mod-z')})"
      disabled={!canUndo}
      onclick={ws.undo}
    />
    <Button
      variant="ghost"
      icon={ICONS.redo}
      title="Redo ({keys('Mod-Shift-z')})"
      disabled={!canRedo}
      onclick={ws.redo}
    />
    <MenuButton
      variant="primary"
      size="md"
      class="export"
      icon={ICONS.export}
      label="Export"
      items={() => exportItems(ws)}
      bind:expanded={exporting}
    />
    <Button
      variant="ghost"
      icon={ICONS.help}
      title="Keyboard and mouse (?)"
      onclick={ws.toggleHelp}
    />
  </div>
</header>

<style>
  .bar {
    grid-area: bar;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: 0 var(--space-4);
    border-bottom: var(--border-width) solid var(--d-line);
    background: var(--d-panel-2);
  }
  .start,
  .end {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .end {
    justify-content: flex-end;
  }
  .end :global(.export) {
    margin: 0 var(--space-3);
    padding: 0 10px;
  }
  .logo {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--d-control);
    height: var(--d-control);
    margin-right: var(--space-2);
    color: var(--d-accent);
  }
  .menubar {
    display: flex;
  }
  .menu-title,
  .chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: var(--d-control);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  .menu-title:hover,
  .chip:hover {
    background: var(--d-hover);
  }
  .menu-title[aria-expanded="true"] {
    background: var(--d-accent-soft);
    color: var(--d-accent-text);
  }
  .menu-title[aria-disabled="true"] {
    background: none;
    color: var(--d-text-3);
    cursor: default;
  }
  .menu-title:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--d-accent);
    outline-offset: 1px;
  }
  /* The letter that opens a menu with Alt shows while Alt is held. */
  .menu-title u {
    text-decoration: none;
  }
  .alt .menu-title u {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* A narrow window leaves the title less room. */
  .narrow :global(.doc-title) {
    max-width: 22vw;
  }
  .doc {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .unsaved {
    flex: none;
    width: 6px;
    height: 6px;
    margin: 0 var(--space-2) 0 calc(var(--space-1) * -1);
    border-radius: 50%;
    background: var(--d-accent);
  }
  .chip {
    gap: var(--space-2);
    padding: 0 var(--space-3);
    color: var(--d-text-2);
  }
</style>
