<!-- The field that names an element or labels a connection on the diagram canvas (DiagramCanvas.svelte), as
     tam-diagrams' old editor had it: over the name's box, as wide as it (wider when its longest line needs) and as high as its lines, in the
     name's size at the zoom, kept inside the stage. Enter or leaving it keeps the text, Shift+Enter starts a line,
     Escape keeps the old one. -->
<script lang="ts">
  import type { Box } from "./diagram-hit.ts";

  type Props = {
    value: string;
    /** The box the name stands in, on the stage. */
    on: Box;
    /** The font's size on screen, and its weight. */
    size: number;
    weight: number;
    /** The stage's size: the field stays inside it. */
    room: { width: number; height: number };
    ondone: (value: string | undefined) => void;
  };
  let { value, on, size, weight, room, ondone }: Props = $props();

  // The field opens anew for each rename, so the name it starts with is all it takes of `value`.
  // svelte-ignore state_referenced_locally
  let text = $state(value);
  let field = $state<HTMLTextAreaElement>();
  let done = false;
  const ruler = document.createElement("canvas").getContext("2d")!;

  const lines = $derived(Math.max(1, text.split("\n").length));
  const place = $derived.by(() => {
    const family = field ? getComputedStyle(field).fontFamily : "system-ui, sans-serif";
    ruler.font = `${weight} ${size}px ${family}`;
    const longest = Math.max(...text.split("\n").map((line) => ruler.measureText(line).width));
    const most = { width: room.width - 8, height: room.height - 8 };
    // The border and the caret beside the longest line: the field covers the element, not more.
    const width = Math.min(Math.max(on.width, longest + 12), most.width);
    const height = Math.min(Math.max(on.height, lines * size * 1.3 + 8), most.height);
    const within = (at: number, length: number, end: number) =>
      Math.max(4, Math.min(at, end + 4 - length));
    return {
      left: within(on.x + on.width / 2 - width / 2, width, most.width),
      top: within(on.y + on.height / 2 - height / 2, height, most.height),
      width,
      height,
      pad: Math.max(0, (height - lines * size * 1.3) / 2),
    };
  });

  function finish(keep: boolean) {
    if (done) return;
    done = true;
    ondone(keep ? text : undefined);
  }
</script>

<textarea
  class="label-edit"
  spellcheck="false"
  rows="1"
  aria-label="Name"
  bind:this={field}
  bind:value={text}
  style:left="{place.left}px"
  style:top="{place.top}px"
  style:width="{place.width}px"
  style:height="{place.height}px"
  style:font-size="{size}px"
  style:font-weight={weight}
  style:padding-top="{place.pad}px"
  onpointerdown={(e) => e.stopPropagation()}
  onkeydown={(e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") finish(false);
  }}
  onblur={() => finish(true)}
  {@attach (el) => (el.focus({ preventScroll: true }), el.select())}
></textarea>

<style>
  .label-edit {
    position: absolute;
    z-index: var(--z-sticky);
    margin: 0;
    padding-right: 0;
    padding-bottom: 0;
    padding-left: 0;
    overflow: hidden;
    border: 2px solid var(--d-accent);
    border-radius: var(--radius-sm);
    outline: none;
    background: var(--d-field);
    box-shadow: var(--shadow-popover);
    color: var(--d-text);
    font-family: var(--font-ui);
    line-height: 1.3;
    text-align: center;
    white-space: pre;
    resize: none;
  }
</style>
