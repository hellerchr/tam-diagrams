<!-- A drag handle that sets a size: `width` (`axis="x"`, the default; a column of its own between panes) or `height`
     (`axis="y"`; it overlays the sized pane's top or bottom edge, so put it inside the pane). `side` says which side of
     the handle the sized pane is on. `max` may be a function, read when a drag starts (e.g. a share of the parent). A double
     click calls `onreset` (back to the pane's own size). -->
<script lang="ts">
  let {
    width = $bindable(0),
    height = $bindable(0),
    axis = "x",
    side,
    min = 200,
    max = 1200,
    onreset,
  }: {
    width?: number;
    height?: number;
    axis?: "x" | "y";
    side: "left" | "right" | "top" | "bottom";
    min?: number;
    max?: number | ((handle: HTMLElement) => number);
    onreset?: () => void;
  } = $props();

  function down(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return; // a right click's release goes to the context menu
    event.preventDefault(); // no text selection while dragging
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const at = (e: PointerEvent) => (axis === "x" ? e.clientX : e.clientY);
    const start = at(event);
    const initial = axis === "x" ? width : height;
    const limit = typeof max === "function" ? max(handle) : max;
    const grows = side === "left" || side === "top" ? 1 : -1;
    // Losing the capture ends the drag: it follows every release, and a cancel that sends none.
    const end = () => handle.removeEventListener("pointermove", move);
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) return end(); // released where we never heard it
      const next = Math.round(Math.max(min, Math.min(limit, initial + grows * (at(e) - start))));
      if (axis === "x") width = next;
      else height = next;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", end, { once: true });
  }
</script>

<div
  class="resizer {axis} {side}"
  role="separator"
  aria-orientation={axis === "x" ? "vertical" : "horizontal"}
  onpointerdown={down}
  ondblclick={onreset}
></div>

<style>
  /* The grab area is wider than the line it shows on hover: `--edge` is the space on each side of that line. */
  .resizer {
    --edge: calc((var(--resizer-hit) - var(--border-width)) / 2);
    --line:
      transparent var(--edge), var(--c-accent) var(--edge),
      var(--c-accent) calc(var(--edge) + var(--border-width)),
      transparent calc(var(--edge) + var(--border-width));
    flex: none;
    z-index: var(--z-sticky);
  }
  .x {
    width: var(--resizer-hit);
    margin: 0 calc(-1 * var(--edge));
    cursor: col-resize;
  }
  .x:hover,
  .x:active {
    background: linear-gradient(to right, var(--line));
  }
  .y {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--resizer-hit);
    cursor: row-resize;
  }
  .y.bottom {
    top: calc(-1 * var(--edge));
  }
  .y.top {
    bottom: calc(-1 * var(--edge));
  }
  .y:hover,
  .y:active {
    background: linear-gradient(var(--line));
  }
</style>
