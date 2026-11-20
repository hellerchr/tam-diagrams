<!-- The open menu (lib/overlays openMenu) and the submenus open from it; mounted by Overlays.svelte. A row shows a mark
     column (its icon, or a tick for a choice that is on) when any row of its menu has one, the label, its keys or a
     note at the right, and a chevron when it opens a submenu; a row that is off is dimmed and says why in its tooltip.
     The pointer resting on a row opens its submenu, a moment later while another is open (the way to it crosses other
     rows). Keys (lib/menu.ts): the arrows, Home and End move over the rows that are on, a letter goes to the next row
     it starts, Enter or Space picks, the right arrow opens a submenu and the left one closes it (at the top level both
     step along a menu bar: options.step), Escape and Tab close. A press outside closes the menus; the pointer moving
     outside them is told to options.over (a menu bar opens the title it passes). -->
<script lang="ts">
  import { Check, ChevronRight } from "lucide";
  import { besideRow, isRow, isSub, moved, placed, refusal, tidy, typedTo } from "../lib/menu.ts";
  import { closeMenu, type MenuEntry, type MenuItem, overlays } from "../lib/overlays.svelte.ts";
  import Icon from "./Icon.svelte";

  /** One open menu: its rows, the highlighted one, the one asking its question, the row of the menu before that
   *  opened it (`from`, with its place), and where it stands. */
  type Level = {
    items: MenuItem[];
    marks: boolean;
    active: number;
    asking: number;
    from: number;
    row?: DOMRect;
    left: number;
    top: number;
  };

  let levels = $state<Level[]>([]);
  const panels = $state<HTMLDivElement[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function level(entries: readonly MenuEntry[], from = -1, row?: DOMRect): Level {
    const items = tidy(entries);
    const marks = items.some((item) => isRow(item) && (!!item.icon || item.checked !== undefined));
    return { items, marks, active: -1, asking: -1, from, row, left: -9999, top: 0 };
  }

  /** What had the focus before the menus opened: it gets it back when they close and nothing took it. */
  let before: Element | null = null;
  let wasOpen = false;

  $effect(() => {
    const menu = overlays.menu;
    clearTimeout(timer);
    const first = menu && level(menu.items);
    if (first && menu.options?.first) first.active = moved(first.items, -1, "Home") ?? -1;
    if (first && !wasOpen) before = document.activeElement;
    if (!first && before) giveBack(before);
    wasOpen = !!first;
    levels = first ? [first] : [];
  });

  function giveBack(to: Element) {
    before = null;
    queueMicrotask(() => {
      const active = document.activeElement;
      if ((!active || active === document.body) && to instanceof HTMLElement && to.isConnected)
        to.focus({ preventScroll: true });
    });
  }

  /** Places a menu once it has a size, and gives it the keys. */
  function place(node: HTMLDivElement, at: Level) {
    const size = { width: node.offsetWidth, height: node.offsetHeight }; // layout size: the arrival's scale would skew a rect
    const room = { width: innerWidth, height: innerHeight };
    const spot = at.row
      ? besideRow(at.row, size, room)
      : overlays.menu && placed(overlays.menu.at, size, room);
    if (spot) Object.assign(at, spot);
    node.focus({ preventScroll: true });
  }

  /** Highlights a row; a question asked in another row is dropped. */
  function point(i: number, index: number) {
    const at = levels[i];
    if (!at) return;
    at.active = index;
    if (at.asking !== index) at.asking = -1;
  }

  /** The row at `index` of menu `i` is entered: its submenu opens beside it, any other closes. */
  function enter(i: number, index: number) {
    const item = levels[i]?.items[index];
    if (!item || !isRow(item) || !isSub(item) || refusal(item)) return void levels.splice(i + 1);
    if (levels[i + 1]?.from === index) return;
    const row = panels[i]?.querySelector(`[data-index="${index}"]`)?.getBoundingClientRect();
    levels.splice(i + 1, levels.length, level(item.items, index, row));
  }

  /** Opens the submenu of the highlighted row with its first row highlighted; false when the row has none. */
  function openSub(i: number, index: number): boolean {
    enter(i, index);
    const sub = levels[i + 1];
    if (!sub || sub.from !== index) return false;
    sub.active = moved(sub.items, -1, "Home") ?? -1;
    panels[i + 1]?.focus({ preventScroll: true });
    return true;
  }

  function pick(i: number, index: number) {
    const at = levels[i];
    const item = at?.items[index];
    if (!at || !item || !isRow(item) || refusal(item)) return;
    if (isSub(item)) return void openSub(i, index);
    if (item.confirm && at.asking !== index) return void (at.asking = index);
    closeMenu();
    item.action();
  }

  /** The pointer came onto a row: it is highlighted, and its submenu opens (or another closes) a moment later. */
  function hover(i: number, index: number) {
    const at = levels[i];
    const item = at?.items[index];
    if (!at || !item) return;
    if (isRow(item) && !refusal(item)) point(i, index);
    else at.active = -1;
    panels[i]?.focus({ preventScroll: true });
    clearTimeout(timer);
    timer = setTimeout(
      () => levels[i]?.items[index] === item && enter(i, index),
      levels.length > i + 1 ? 220 : 60,
    );
  }

  const typesLetter = (e: KeyboardEvent) =>
    e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;

  /** The arrows across: into and out of a submenu, or along the menu bar at the top. */
  function across(i: number, at: Level, by: 1 | -1) {
    if (by > 0 && at.active >= 0 && openSub(i, at.active)) return;
    if (by < 0 && i > 0) {
      levels.splice(i);
      return panels[i - 1]?.focus({ preventScroll: true });
    }
    overlays.menu?.options?.step?.(by);
  }

  function key(i: number, at: Level, e: KeyboardEvent) {
    const to = moved(at.items, at.active, e.key);
    const typed = typesLetter(e) ? typedTo(at.items, at.active, e.key) : undefined;
    if (to !== undefined || typed !== undefined) {
      point(i, (to ?? typed)!);
      levels.splice(i + 1);
    } else if (e.key === "Enter" || e.key === " ") pick(i, at.active);
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft")
      across(i, at, e.key === "ArrowRight" ? 1 : -1);
    else if (e.key === "Escape" || e.key === "Tab") closeMenu();
    else if (!typesLetter(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  const tipOf = (at: Level, index: number, off: string | true | undefined, title?: string) =>
    typeof off === "string" ? off : index === at.asking ? undefined : title;
</script>

<svelte:window
  onresize={() => levels.length && closeMenu()}
  onblur={() => levels.length && closeMenu()}
/>

{#if levels.length}
  <div
    class="catcher"
    role="presentation"
    onpointerdown={closeMenu}
    onpointermove={(e) => overlays.menu?.options?.over?.(e)}
    oncontextmenu={(e) => (e.preventDefault(), closeMenu())}
  ></div>
{/if}
{#each levels as at, i (at)}
  <div
    class="menu popover"
    class:sub={i > 0}
    role="menu"
    tabindex="-1"
    bind:this={panels[i]}
    use:place={at}
    style:left="{at.left}px"
    style:top="{at.top}px"
    onkeydown={(e) => key(i, at, e)}
    onpointerenter={() => clearTimeout(timer)}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each at.items as item, index (index)}
      {#if item === "separator"}
        <div class="separator"></div>
      {:else if "heading" in item}
        <div class="heading meta">{item.heading}</div>
      {:else}
        {@const off = refusal(item)}
        {@const sub = isSub(item)}
        {@const open = sub && levels[i + 1]?.from === index}
        <button
          class="option"
          class:danger={item.danger}
          class:active={index === at.active || open}
          class:asking={index === at.asking}
          data-index={index}
          role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={item.checked === undefined ? undefined : item.checked}
          aria-haspopup={sub ? "menu" : undefined}
          aria-expanded={sub ? open : undefined}
          aria-disabled={off ? true : undefined}
          tabindex="-1"
          title={tipOf(at, index, off, item.title)}
          onpointerenter={() => hover(i, index)}
          onclick={() => pick(i, index)}
        >
          {#if at.marks}
            <span class="mark">
              {#if item.icon}<Icon icon={item.icon} size={14} />{:else if item.checked}<Icon
                  icon={Check}
                  size={14}
                />{/if}
            </span>
          {/if}
          <span class="text"
            >{index === at.asking && "confirm" in item ? item.confirm : item.label}</span
          >
          {#if item.hint}<span class="meta hint">{item.hint}</span>{:else if item.note}<span
              class="meta note">{item.note}</span
            >{/if}
          {#if sub}<span class="chevron"><Icon icon={ChevronRight} size={14} /></span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/each}

<style>
  /* Catches the press outside an open menu (and dims nothing). */
  .catcher {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
  }
  .menu {
    position: fixed;
    min-width: var(--menu-min);
    max-width: var(--menu-max);
    max-height: calc(100dvh - 2 * var(--space-4));
    overflow-y: auto;
    outline: none;
  }
  .heading {
    padding: var(--space-3) var(--space-4) var(--space-1);
    font-size: var(--text-xs);
  }
  .danger {
    color: var(--c-danger);
  }
  .asking,
  .asking .mark {
    color: var(--c-accent);
  }
  .option.asking {
    background: var(--c-accent-soft);
  }
  .option[aria-disabled="true"] {
    background: none;
    color: var(--c-dim);
    cursor: default;
  }
  .mark {
    display: inline-flex;
    flex: none;
    width: var(--icon-sm);
    color: var(--c-muted);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint,
  .note {
    flex: none;
    margin-left: var(--space-6);
  }
  [aria-disabled="true"] :is(.hint, .note, .mark, .chevron) {
    color: var(--c-dim);
  }
  .chevron {
    display: inline-flex;
    margin-right: calc(var(--space-2) * -1);
    color: var(--c-muted);
  }
  .separator {
    height: var(--border-width);
    margin: var(--space-2) var(--space-3);
    background: var(--c-border);
  }
  /* Key hints mean nothing on a touch screen (ui/Kbd.svelte leaves them out there too). */
  @media (hover: none) {
    .hint {
      display: none;
    }
  }
</style>
