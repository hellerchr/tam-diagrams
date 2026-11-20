<!-- The strips over the foot of the source in the right panel (DiagramSide.svelte), as the old editor had them: the
     problem of the source, and two elements of a block diagram that lie on each other (not while there is a problem).
     Over the text, so it stays where it is when one comes and goes. Each says its problem in one line; a click shows it
     whole, and where the problem is: the source at its line, or the elements selected and fitted in view. -->
<script lang="ts">
  import { oneLine, overlapText, problemText, proseBits } from "./diagram-side.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  let { ws }: { ws: Workbench } = $props();

  const problem = $derived(ws.problem);
  /** The first two elements that lie on each other, by their ids. */
  const pair = $derived.by(() => {
    const { ed } = ws;
    if (problem || ed.uml || !ed.edits || !ed.model) return undefined;
    return ed.edits.overlaps(ed.model)[0] as [string, string] | undefined;
  });
  const names = $derived(
    pair &&
      (pair.map((id) => oneLine(ws.ed.labelOf({ type: "element", id }) || id)) as [string, string]),
  );

  /** The strip shown whole; it says its problem in one line again when the problem changes. */
  let whole = $state<string>();
  const said = $derived(problem ? problemText(problem) : names ? overlapText(names) : undefined);

  function show() {
    whole = whole === said ? undefined : said;
    if (problem) return ws.host.onproblem(problem.line);
    if (!pair) return;
    ws.ed.selection = pair.map((id) => ({ type: "element", id }));
    ws.fitSelection();
  }
</script>

{#if said}
  <div class="strips">
    <button class="strip" class:warning={!problem} class:whole={whole === said} onclick={show}>
      {#each proseBits(said) as bit, i (i)}{#if bit.code}<code>{bit.text}</code
          >{:else}{bit.text}{/if}{/each}
    </button>
  </div>
{/if}

<style>
  .strips {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
  }
  .strip {
    display: block;
    width: 100%;
    padding: var(--space-3) var(--space-5);
    overflow: hidden;
    border-top: var(--border-width) solid color-mix(in srgb, var(--d-danger) 30%, var(--d-line));
    background: color-mix(in srgb, var(--d-danger) 10%, var(--d-panel));
    color: var(--d-danger);
    font-size: var(--text-sm);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
  .strip.whole {
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .strip code {
    padding: 0 3px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--d-danger) 12%, transparent);
    font-family: var(--font-code);
    font-size: var(--text-xs);
  }
  .strip.warning {
    border-top-color: color-mix(in srgb, var(--d-warning) 30%, var(--d-line));
    background: color-mix(in srgb, var(--d-warning) 14%, var(--d-panel));
    color: var(--d-warning);
  }
</style>
