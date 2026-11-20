<!-- The diagram's title in the bar (DiagramBar.svelte), as in tam-diagrams' editor: a field as wide as its text (the
     text lies under the field and gives the box its width, up to 30% of the window; a longer one is said whole by the
     tooltip). Enter or leaving the field writes the title into the source's header (diagram-props.ts, loaded as the
     Properties load it), an empty one removes it; Escape puts back the title the source has. -->
<script lang="ts">
  import type * as Props from "./diagram-props.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  let { ws }: { ws: Workbench } = $props();

  let P = $state.raw<typeof Props>();
  void import("./diagram-props.ts").then((module) => (P = module));

  /** The title the source says (before the header's reader loads: its `title` line). */
  const said = $derived(
    P
      ? (P.headerOf(ws.source, ws.notation)?.title ?? "")
      : (/^\s*title\s*:?\s*(.+)$/m.exec(ws.source)?.[1]?.trim() ?? ""),
  );
  let input = $state<HTMLInputElement>();
  let editing = $state(false);
  let draft = $state("");
  let kept = false;
  const shown = $derived(editing ? draft : said);

  /** The title is longer than its box: the tooltip says it whole. */
  let long = $state(false);
  $effect(() => {
    void shown;
    if (input) long = input.scrollWidth > input.clientWidth + 1;
  });

  function commit() {
    editing = false;
    const title = draft.trim();
    if (kept || title === said || !P) return void (kept = false);
    const { withHeader } = P;
    ws.ed.amend((source) => withHeader(source, ws.notation, { title }));
  }

  function key(e: KeyboardEvent) {
    if (e.key === "Enter") input?.blur();
    else if (e.key === "Escape") {
      kept = true;
      input?.blur();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<label
  class="doc-title"
  data-value={shown || "Untitled"}
  title={long && !editing ? said : undefined}
>
  <input
    type="text"
    spellcheck="false"
    placeholder="Untitled"
    aria-label="Title of the diagram"
    bind:this={input}
    value={shown}
    oninput={(e) => (draft = e.currentTarget.value)}
    onfocus={() => ((draft = said), (editing = true))}
    onblur={commit}
    onkeydown={key}
  />
</label>

<style>
  .doc-title {
    position: relative;
    display: inline-grid;
    min-width: 40px;
    max-width: 30vw;
    height: var(--d-control);
    border-radius: var(--radius-sm);
  }
  .doc-title::after {
    content: attr(data-value);
    visibility: hidden;
    overflow: hidden;
    padding: 0 10px;
    font-weight: var(--weight-semibold);
    line-height: var(--d-control);
    white-space: pre;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    padding: 0 var(--space-4);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--d-text);
    font: inherit;
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
  }
  input::placeholder {
    color: var(--d-text-3);
  }
  input:hover {
    background: var(--d-hover);
  }
  input:focus {
    border-color: var(--d-accent);
    outline: none;
    background: var(--d-field);
    box-shadow: 0 0 0 2px var(--d-accent-soft);
  }
</style>
