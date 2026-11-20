<!-- The body of the guide sheet (GuidePanel.svelte), as the old editor's reference-dialog.ts drew it: a guide's
     sections, each with its prose, its rules, its rows (the code in the source's colors beside what it means; the
     buttons that write a row into the source and copy it show with the pointer or the focus on it; Enter and C do the
     same from the keyboard) and its whole example (Copy, Open as diagram); or, for "All guides", the list of every
     guide with what its diagram shows. -->
<script lang="ts">
  import { Copy, Plus } from "lucide";
  import type { Guide, GuideRow, GuideSection } from "../../src/reference.ts";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import { typeIcon } from "./diagram-chooser.ts";
  import type { Bit } from "./diagram-guide-code.ts";
  import { refusedSection, type ShownSection, wideRow, writes } from "./diagram-guide.ts";
  import { ICONS } from "./diagram-icons.ts";
  import type { DiagramKind } from "./diagram-types.ts";

  type Code = typeof import("./diagram-guide-code.ts");
  type Props = {
    /** The guide on show; undefined: the list of all guides. */
    guide: Guide | undefined;
    guides: Guide[];
    shown: ShownSection[];
    code: Code;
    onpick: (guide: Guide) => void;
    oninsert: (text: string) => void;
    oncopy: (text: string) => void;
    onexample: (source: string, anchor: HTMLElement) => void;
  };
  let { guide, guides, shown, code, onpick, oninsert, oncopy, onexample }: Props = $props();

  /** The row Tab stops at: the first on show; the arrow keys go from there. */
  const first = $derived(shown.find((part) => part.rows.length)?.rows[0]);

  /** A key on a row: Enter writes it into the source, where it is a statement to write; C copies it. */
  function rowKey(event: KeyboardEvent, item: GuideRow) {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (event.key === "Enter" && writes(item)) oninsert(item.write);
    else if (event.key.toLowerCase() === "c") oncopy(item.write);
    else return;
    event.preventDefault();
  }
</script>

{#snippet colored(bits: Bit[])}{#each bits as bit, i (i)}{#if bit.tok}<span class={bit.tok}
        >{bit.text}</span
      >{:else}{bit.text}{/if}{/each}{/snippet}

{#snippet prose(text: string)}
  {#each text.split("`") as bit, i (i)}{#if i % 2}<code>{bit}</code>{:else}{bit}{/if}{/each}
{/snippet}

{#snippet row(g: Guide, section: GuideSection, item: GuideRow)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a row is a stop of
       the arrow keys, with keys of its own) -->
  <div
    class="row"
    class:wide={wideRow(item)}
    role="listitem"
    tabindex={item === first ? 0 : -1}
    onkeydown={(e) => rowKey(e, item)}
  >
    <code class="code">{@render colored(code.rowCode(g, section, item))}</code>
    <span class="means">{@render prose(item.means)}</span>
    <span class="acts">
      {#if writes(item)}
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          title="Insert into the source (Enter)"
          tabindex={-1}
          onclick={() => oninsert(item.write)}
        />
      {/if}
      <Button
        variant="ghost"
        size="sm"
        icon={Copy}
        title="Copy (C)"
        tabindex={-1}
        onclick={() => oncopy(item.write)}
      />
    </span>
  </div>
{/snippet}

{#if guide}
  {@const g = guide}
  {#each shown as { section, prose: text, rules, rows, example } (section.id)}
    <section id="guide-{section.id}">
      <h3>{section.title}</h3>
      {#if text}<p class="prose">{@render prose(text)}</p>{/if}
      {#if rules.length}<ul class="rules">
          {#each rules as rule (rule)}<li>{@render prose(rule)}</li>{/each}
        </ul>{/if}
      {#if rows.length}
        <div class="rows" class:refused={refusedSection(section)} role="list">
          {#each rows as item (item)}{@render row(g, section, item)}{/each}
        </div>
      {/if}
      {#if example}
        <div class="example">
          <pre><code class="code">{@render colored(code.exampleCode(g, example))}</code></pre>
          <div class="example-acts">
            <Button icon={Copy} onclick={() => oncopy(example)}>Copy</Button>
            <Button
              title="Show this example in place of the diagram"
              onclick={(e) => onexample(example, e.currentTarget)}>Open as diagram</Button
            >
          </div>
        </div>
      {/if}
    </section>
  {/each}
{:else}
  <div class="index">
    {#each guides as each (each.type)}
      <button class="entry" onclick={() => onpick(each)}>
        <Icon icon={ICONS[typeIcon(each.type as DiagramKind)]} size={16} />
        <span><strong>{each.name}</strong><span class="note">{each.about}</span></span>
      </button>
    {/each}
  </div>
{/if}

<style>
  section {
    content-visibility: auto;
    contain-intrinsic-size: auto 400px;
  }
  h3 {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0 calc(-1 * var(--space-5)) var(--space-3);
    padding: 14px var(--space-5) var(--space-3);
    background: var(--c-popover);
    color: var(--c-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  p {
    margin: 0 0 var(--space-4);
  }
  .rules {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-6);
  }
  .rules li {
    margin-bottom: 5px;
  }
  .rules li::marker {
    color: var(--c-dim);
  }
  code {
    color: var(--syn-type);
    font-family: var(--font-code);
    font-size: calc(var(--text-code) - 1.5px);
    font-variant-ligatures: none;
  }
  .means code,
  .prose code,
  .rules code {
    white-space: nowrap;
  }
  /* A row: what is written beside what it means; long code stands above its meaning. */
  .row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 9fr) minmax(0, 11fr);
    align-items: baseline;
    gap: var(--space-1) var(--space-5);
    /* At the right the room of the buttons that show with the pointer or the focus on the row. */
    padding: 5px 56px 5px var(--space-3);
    border-top: var(--border-width) solid color-mix(in srgb, var(--c-border) 70%, transparent);
    outline: none;
  }
  .row.wide {
    grid-template-columns: minmax(0, 1fr);
  }
  .row:hover,
  .row:focus {
    background: var(--c-surface);
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--c-accent);
  }
  .code {
    color: var(--c-foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .refused .row {
    border-left: 2px solid color-mix(in srgb, var(--c-danger) 55%, transparent);
  }
  .acts {
    position: absolute;
    top: 1px;
    right: var(--space-1);
    display: none;
    gap: 1px;
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-sm);
    background: var(--c-popover);
    box-shadow: var(--shadow-popover);
  }
  .row:hover .acts,
  .row:focus .acts,
  .row:focus-within .acts {
    display: flex;
  }
  .example pre {
    margin: 0;
    padding: var(--space-4) 10px;
    overflow-x: auto;
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-sm);
    background: var(--c-input);
  }
  .example .code {
    white-space: pre;
  }
  .example-acts {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  .index {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-4);
  }
  .entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: var(--space-4);
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .entry:hover {
    background: var(--c-hover);
  }
  .entry strong,
  .entry .note {
    display: block;
  }
  .entry strong {
    font-weight: var(--weight-semibold);
  }
  .note {
    color: var(--c-muted);
  }
  .entry:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }
</style>
