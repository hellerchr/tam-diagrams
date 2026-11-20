<!-- The guide sheet: the syntax guide of a diagram type (src/tam/reference.ts, loaded when it first opens), as the old
     editor's reference-dialog.ts had it. In the diagram editor it is docked between the canvas and the right panel
     (DiagramView.svelte); beside the source alone in Source mode (Editor.svelte). Its head picks the guide (or All
     guides) and closes it; the filter keeps what has every word of it (a section whose title has them shows whole), the
     links bring a section to the top; the body is GuideBody.svelte. A row is written into the source, or copied; an
     example replaces the diagram. The arrows go from row to row, Escape clears the filter, then closes. It follows the
     source's type as that changes. -->
<script lang="ts">
  import { CircleHelp, X } from "lucide";
  import { untrack } from "svelte";
  import type { Guide } from "../../src/reference.ts";
  import { openMenu, toast } from "../lib/overlays.svelte.ts";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import { type DiagramKind, typeOf } from "./diagram-types.ts";
  import {
    linkLabel,
    narrowGuide,
    otherSyntax,
    rowCount,
    stopAfter,
    wordsOf,
  } from "./diagram-guide.ts";
  import GuideBody from "./GuideBody.svelte";

  type Props = {
    /** The file's language: tam or mermaid. */
    lang: string;
    /** The source on show (undefined while it loads): the guide follows its type. */
    source: string | undefined;
    /** Opened on the list of all guides rather than the source's guide. */
    all?: boolean;
    oninsert: (text: string) => void;
    /** Show `source`, a guide's example, in place of the diagram; `anchor` is the button that asked. */
    onexample: (source: string, anchor: HTMLElement) => void;
    onclose: () => void;
  };
  let { lang, source, all = false, oninsert, onexample, onclose }: Props = $props();

  type Reference = typeof import("../../src/reference.ts");
  type Code = typeof import("./diagram-guide-code.ts");
  let ref = $state.raw<Reference>();
  let code = $state.raw<Code>();
  /** The guide on show; undefined: the list of all guides. */
  let guide = $state.raw<Guide>();
  let filter = $state("");
  let body = $state<HTMLDivElement>();
  let field = $state<HTMLInputElement>();

  void Promise.all([import("../../src/reference.ts"), import("./diagram-guide-code.ts")]).then(
    ([r, c]) => {
      ref = r;
      code = c;
    },
  );

  /** The guide of the source on show: its header's, or the first of its language. */
  const current = $derived(
    ref && source !== undefined
      ? ref.guideOf(ref.guideTypeOf(lang, source) ?? (lang === "tam" ? "tam" : "class"))
      : undefined,
  );
  let started = false;
  $effect(() => {
    const wanted = current;
    if (!wanted) return;
    untrack(() => show(!started && all ? undefined : wanted));
    started = true;
  });

  /** Shows a guide, or the list of all, from its top, with the focus on the filter (or the first guide of the list). */
  export function show(next: Guide | undefined) {
    guide = next;
    filter = "";
    body?.scrollTo(0, 0);
    requestAnimationFrame(() =>
      (next ? field : body?.querySelector<HTMLElement>("button"))?.focus(),
    );
  }
  /** Whether it shows the guide of the source on show. */
  export const showsCurrent = () => !!guide && guide === current;
  export const showCurrent = () => show(current);
  export const showAll = () => show(undefined);

  const words = $derived(wordsOf(filter));
  const shown = $derived(guide ? narrowGuide(guide, words) : []);
  const count = $derived(
    rowCount(
      words,
      shown.reduce((sum, part) => sum + part.rows.length, 0),
    ),
  );

  /** Writes a row into the source when the source is of the guide's type, else says whose syntax it is. */
  function insert(text: string) {
    if (current === guide) return oninsert(text);
    const shown = source?.trim() && current && typeOf(current.type as DiagramKind);
    toast(otherSyntax(guide?.name ?? "", shown ? shown.name : undefined), "error");
  }

  function copy(text: string) {
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("No clipboard"))).then(
      () => toast("Copied."),
      () => toast("The browser did not let the page copy.", "error"),
    );
  }

  /** Brings a section to the top, with the focus on its first row. */
  function jump(id: string) {
    const section = body?.querySelector<HTMLElement>(`#guide-${id}`);
    if (!section || !body) return;
    body.scrollTop = section.offsetTop - body.offsetTop;
    section.querySelector<HTMLElement>(".row")?.focus({ preventScroll: true });
  }

  function pickGuide(anchor: HTMLElement) {
    if (!ref) return;
    const items = ref.GUIDES.map((g) => ({
      label: g.name,
      checked: g === guide,
      action: () => show(g),
    }));
    openMenu(
      anchor,
      [...items, { label: "All guides", checked: !guide, action: () => show(undefined) }],
      { right: false },
    );
  }

  /** The keys of the sheet, which are its own (the canvas does not act on them): Escape clears the filter, then
   *  closes; the arrows, Home and End go from row to row. */
  function key(event: KeyboardEvent) {
    // The window's own keys (F1, Ctrl+K, …) still run.
    if (!/^F\d/.test(event.key) && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!filter) return onclose();
      filter = "";
      field?.focus();
      return;
    }
    const rows = [...(body?.querySelectorAll<HTMLElement>(".row") ?? [])];
    const at = rows.indexOf(event.target as HTMLElement);
    const next = stopAfter(event.key, at, rows.length, event.target === field);
    if (next === undefined) return;
    event.preventDefault();
    (next === "filter" ? field : rows[next])?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="guide" aria-label="Guide" onkeydown={key}>
  <header>
    <Icon icon={CircleHelp} size={16} />
    <h2>Guide</h2>
    <button class="choice" aria-label="Guide of" onclick={(e) => pickGuide(e.currentTarget)}>
      <span>{guide?.name ?? "All guides"}</span>
    </button>
    <Button variant="ghost" size="sm" icon={X} title="Close the guide (Esc)" onclick={onclose} />
  </header>
  {#if guide}
    <div class="tools">
      <input
        class="input"
        bind:this={field}
        bind:value={filter}
        placeholder="Filter this guide"
        aria-label="Filter this guide"
        spellcheck="false"
      />
      {#if count}<span class="count">{count}</span>{/if}
    </div>
    <nav aria-label="Sections">
      {#each guide.sections as section (section.id)}
        <button class="link" title={section.title} onclick={() => jump(section.id)}
          >{linkLabel(section.id)}</button
        >
      {/each}
    </nav>
  {/if}
  <div class="body" bind:this={body}>
    {#if ref && code}
      <GuideBody
        {guide}
        guides={ref.GUIDES}
        {shown}
        {code}
        onpick={show}
        oninsert={insert}
        oncopy={copy}
        {onexample}
      />
    {/if}
  </div>
</aside>

<style>
  .guide {
    display: flex;
    flex: none;
    flex-direction: column;
    width: min(440px, 100%);
    min-width: 0;
    min-height: 0;
    border-left: var(--border-width) solid var(--c-border);
    background: var(--c-popover);
    color: var(--c-foreground);
    font-size: var(--text-sm);
    user-select: text;
  }
  header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3);
    height: 36px;
    padding: 0 var(--space-2) 0 10px;
    border-bottom: var(--border-width) solid var(--c-border);
    background: var(--c-chrome);
    user-select: none;
  }
  h2 {
    margin: 0;
    font-size: inherit;
    font-weight: var(--weight-semibold);
  }
  .choice {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: var(--control-sm);
    padding: 0 var(--space-7) 0 var(--space-4);
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-sm);
    background: var(--c-input)
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E")
      no-repeat right var(--space-4) center;
    text-align: left;
  }
  .choice span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .choice:hover {
    border-color: color-mix(in srgb, var(--c-border) 70%, var(--c-foreground));
  }
  .tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5) var(--space-3);
  }
  .tools input {
    flex: 1;
    height: var(--control-sm);
  }
  .count {
    color: var(--c-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  nav {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--space-5) var(--space-4);
    border-bottom: var(--border-width) solid var(--c-border);
    user-select: none;
  }
  .link {
    height: 20px;
    padding: 0 var(--space-4);
    border-radius: 10px;
    background: var(--c-chrome);
    color: var(--c-muted);
    font-size: var(--text-xs);
  }
  .link:hover {
    background: var(--c-selected);
    color: var(--c-foreground);
  }
  .link:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-5) var(--space-8);
    overflow-y: auto;
    line-height: 17px;
    scrollbar-width: thin;
  }
</style>
