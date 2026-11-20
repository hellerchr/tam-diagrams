<!-- What the diagram canvas (DiagramCanvas.svelte) draws over the picture, in the stage's pixels, as tam-diagrams' old
     editor drew it (editor/overlay.ts): what the pointer is over, elements that lie on each other, the selection with
     its handles and connection dots, the ends of a selected connection, the guides a drag lines up on, a new element
     before it is placed, and what a gesture under way shows (the band, a connection being drawn, an end being
     attached, a label being dragged, what a move would drop into). While a connection is drawn or an end dragged
     (and under the connect tool), the ports of the elements it joins show, the one it takes filled (diagram-ports.ts). -->
<script lang="ts">
  import type { Gesture } from "./diagram-gesture-kinds.ts";
  import { handled, linkHosts, wireEnds } from "./diagram-gesture-press.ts";
  import { type Box, middle, type Part, type Point } from "./diagram-hit.ts";
  import {
    boxOnScreen,
    dropPlace,
    HANDLE,
    handlePoints,
    linkPoints,
    sizeOf,
    toScreen,
  } from "./diagram-marks.ts";
  import { type Port, PORT_SIZES, portOn, portsOn, rankOf } from "./diagram-ports.ts";
  import { portPoint, samePort } from "../../src/tam-ports.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  let { ws }: { ws: Workbench } = $props();
  const g = $derived(ws.g);
  const ed = $derived(ws.ed);
  const view = $derived(ws.camera.view);
  const hits = $derived(ed.shown?.hits);
  const gesture = $derived<Gesture | undefined>(g.gesture);

  const bare = (id: string) => id.replace(/#\d+$/, "");
  /** The boxes an element is drawn in, on the stage, `pad` pixels out. */
  const boxes = (id: string, pad: number): Box[] =>
    (hits?.elements ?? [])
      .filter((e) => e.id === id)
      .map((e) => grownOn(g.shownBox(id, e.box), pad));
  const grownOn = (box: Box, pad: number): Box => {
    const on = boxOnScreen(view, box);
    return { x: on.x - pad, y: on.y - pad, width: on.width + 2 * pad, height: on.height + 2 * pad };
  };
  /** The lines a connection is drawn with, on the stage. */
  const lines = (id: string) =>
    (hits?.wires ?? [])
      .filter((w) => bare(w.id) === id)
      .map((w) =>
        w.points
          .map((p) => toScreen(view, p))
          .map((p) => `${p.x},${p.y}`)
          .join(" "),
      );
  /** The circles on a connection's line (a channel's), on the stage. */
  const circles = (id: string) =>
    (hits?.wires ?? []).flatMap((w) =>
      bare(w.id) === id && w.circle ? [boxOnScreen(view, w.circle)] : [],
    );
  const center = (id: string) => {
    const box = ed.elementBox(id);
    return box && toScreen(view, middle(box));
  };

  const selected = (part: Part) => ed.isSelected(part);
  const hover = $derived(
    g.hover && !gesture && ws.tool !== "pan" && !selected(g.hover) ? g.hover : undefined,
  );
  const overlapping = $derived.by(() => {
    const { model, edits } = ed;
    return model && edits ? [...new Set(edits.overlaps(model).flat())] : [];
  });
  const one = $derived(!gesture || gesture.type === "resize" ? handled(g) : undefined);
  const handles = $derived(one ? handlePoints(view, g.shownBox(one.id, one.box)) : []);
  const dots = $derived(gesture ? [] : linkHosts(g).flatMap(({ box }) => linkPoints(view, box)));
  const pointer = $derived(g.screen);
  const ends = $derived(wireEnds(g));
  const ghost = $derived.by(() => {
    const it = ws.ghost;
    if (!it || (gesture && gesture.type !== "place")) return undefined;
    const on = boxOnScreen(view, { ...dropPlace(it.kind, it.at, !!it.free), ...sizeOf(it.kind) });
    const round = it.kind === "storage" ? on.height / 2 : it.kind === "group" ? 4 * view.zoom : 0;
    return { on, round, target: it.target };
  });
  const frame = $derived.by(() => {
    if (gesture?.type !== "frame") return undefined;
    const [a, b] = [toScreen(view, gesture.start), toScreen(view, gesture.current)];
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  });
  type PortHost = [id: string, taken: Port | undefined];
  /** The ends of a connection being drawn, or the element an end of one is dragged to, with the ports they take. */
  function gesturePorts(gesture: Gesture): PortHost[] {
    if (gesture.type !== "connect" && gesture.type !== "attach") return [];
    const target: PortHost[] = gesture.target ? [[gesture.target, gesture.port]] : [];
    return gesture.type === "connect" ? [[gesture.from, gesture.fromPort], ...target] : target;
  }
  /** The element under the connect tool, with the port the pointer is on. */
  function hoverPorts(): PortHost[] {
    if (ws.tool !== "connect" || g.hover?.type !== "element" || !pointer) return [];
    const box = ed.elementBox(g.hover.id);
    return box ? [[g.hover.id, portOn(view, box, pointer)]] : [];
  }
  /** The elements whose ports show, a block diagram's only. */
  const portHosts = $derived(!ed.model ? [] : gesture ? gesturePorts(gesture) : hoverPorts());
  const ports = $derived(
    portHosts.flatMap(([id, taken]) => {
      const box = ed.elementBox(id);
      return box
        ? portsOn(view, box).map(({ port, at }) => ({
            at,
            on: samePort(port, taken),
            rank: rankOf(port),
          }))
        : [];
    }),
  );
  /** Where on the stage a connection's end is: at its port, else the middle of its element (or `otherwise`). */
  const endAt = (id: string | undefined, port: Port | undefined, otherwise?: Point) => {
    const box = id && port ? ed.elementBox(id) : undefined;
    return box && port
      ? toScreen(view, portPoint(box, port))
      : (otherwise ?? (id ? center(id) : undefined));
  };
  const near = (dot: Point) =>
    !!pointer && Math.hypot(dot.x - pointer.x, dot.y - pointer.y) <= HANDLE;
  const line = (a: Point, b: Point) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  /** A point of the diagram on the middle of a pixel of the stage: a guide is one pixel wide and sharp. */
  const pixel = (p: Point) => {
    const on = toScreen(view, p);
    return { x: Math.round(on.x) + 0.5, y: Math.round(on.y) + 0.5 };
  };
</script>

{#snippet wire(id: string, cls: string)}
  {#each lines(id) as points, i (i)}<polyline class={cls} {points} />{/each}
  {#each circles(id) as c, i (i)}<circle
      class={cls}
      cx={c.x + c.width / 2}
      cy={c.y + c.height / 2}
      r={c.width / 2 + 1}
    />{/each}
{/snippet}

{#snippet outline(id: string, pad: number, cls: string)}
  {#each boxes(id, pad) as b, i (i)}<rect
      class={cls}
      x={b.x}
      y={b.y}
      width={b.width}
      height={b.height}
    />{/each}
{/snippet}

<svg class="overlay" aria-hidden="true">
  {#if hover}
    {#if hover.type === "element"}{@render outline(hover.id, 2, "hover")}
    {:else}{@render wire(hover.id, "hover wire")}{/if}
  {/if}
  {#each overlapping as id (id)}{@render outline(id, 2, "overlap")}{/each}
  {#each ed.selection as part (part.type + part.id)}
    {#if part.type === "wire"}
      {@render wire(part.id, "selected-wire")}
    {:else}{@render outline(part.id, 3, "selected")}{/if}
  {/each}
  {#each handles as spot, i (i)}
    <rect
      class="handle"
      x={spot.x + spot.handle.x * 3 - HANDLE / 2}
      y={spot.y + spot.handle.y * 3 - HANDLE / 2}
      width={HANDLE}
      height={HANDLE}
    />
  {/each}
  {#each dots as dot, i (i)}<circle
      class="dot"
      class:on={near(dot)}
      cx={dot.x}
      cy={dot.y}
      r={near(dot) ? 6.5 : 4.5}
    />{/each}
  {#each g.guides as [a, b], i (i)}<line class="guide" {...line(pixel(a), pixel(b))} />{/each}
  {#if ghost}
    {#if ghost.target}{@render outline(ghost.target, 4, "ghost-target")}{/if}
    <rect
      class="ghost"
      x={ghost.on.x}
      y={ghost.on.y}
      width={ghost.on.width}
      height={ghost.on.height}
      rx={ghost.round}
    />
  {/if}
  {#if g.pieceTarget}{@render outline(g.pieceTarget, 4, "target")}{/if}
  {#if gesture?.type === "move" && gesture.target}{@render outline(
      gesture.target,
      4,
      "target",
    )}{/if}
  {#if gesture?.type === "label" && gesture.moved}
    {@const b = grownOn(gesture.moved, 2)}
    <rect class="label-drag" x={b.x} y={b.y} width={b.width} height={b.height} />
    <line
      class="label-drag"
      {...line(toScreen(view, gesture.label.middle), toScreen(view, middle(gesture.moved)))}
    />
  {/if}
  {#if frame}<rect
      class="band"
      x={frame.x}
      y={frame.y}
      width={frame.width}
      height={frame.height}
    />{/if}
  {#if gesture?.type === "attach"}
    {#if gesture.target}{@render outline(gesture.target, 3, "reach")}{/if}
    {#if gesture.fixed}
      {@const at = toScreen(view, gesture.fixed)}
      <line
        class="link"
        {...line(at, endAt(gesture.target, gesture.port, toScreen(view, gesture.current))!)}
      />
      <circle class="end" cx={at.x} cy={at.y} r="5" />
    {/if}
  {:else if gesture?.type === "connect"}
    {@const from = endAt(gesture.from, gesture.fromPort)}
    {@render outline(gesture.from, 3, "selected")}
    {#if gesture.target}{@render outline(gesture.target, 3, "reach")}{/if}
    {#if from}<line
        class="link"
        {...line(from, endAt(gesture.target, gesture.port, toScreen(view, gesture.current))!)}
      />{/if}
  {:else if !gesture}
    {#each ends as end (end.end)}{@const at = toScreen(view, end.at)}<circle
        class="end"
        cx={at.x}
        cy={at.y}
        r="5"
      />{/each}
  {/if}
  {#each ports as spot, i (i)}
    <circle
      class="port {spot.rank}"
      class:on={spot.on}
      cx={spot.at.x}
      cy={spot.at.y}
      r={spot.on ? 5.5 : PORT_SIZES[spot.rank]}
    />
  {/each}
</svg>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    fill: none;
    stroke: var(--d-accent);
    stroke-linejoin: round;
    stroke-width: 1.5px;
  }
  .hover {
    stroke-opacity: 0.45;
  }
  .hover.wire {
    stroke-width: 3px;
  }
  .overlap {
    stroke: var(--d-danger);
    stroke-width: 2px;
    stroke-dasharray: 4 3;
  }
  .selected-wire {
    stroke-width: 2.5px;
  }
  .handle {
    fill: #fff;
  }
  .dot {
    fill: var(--d-accent);
    fill-opacity: 0.75;
    stroke: none;
  }
  .dot.on {
    fill-opacity: 1;
  }
  .guide {
    stroke: #e0457b;
    stroke-width: 1px;
  }
  .ghost {
    fill: color-mix(in srgb, var(--d-accent) 12%, transparent);
  }
  .ghost-target {
    stroke-dasharray: 6 4;
  }
  .target {
    stroke-width: 2px;
    stroke-dasharray: 6 4;
  }
  .label-drag {
    stroke-width: 1px;
    stroke-dasharray: 4 3;
  }
  .band {
    fill: color-mix(in srgb, var(--d-accent) 8%, transparent);
    stroke-width: 1px;
  }
  .reach {
    stroke-width: 2px;
  }
  .link {
    stroke-dasharray: 5 4;
  }
  .end {
    fill: #fff;
    stroke-width: 2px;
  }
  .port {
    fill: var(--d-panel-2);
    stroke-width: 1.5px;
  }
  /* The middle and the quarters stand out, the ports between them stay quiet. */
  .port.between {
    stroke-width: 1px;
    stroke-opacity: 0.6;
  }
  .port.middle {
    stroke-width: 2px;
  }
  .port.on {
    fill: var(--d-accent);
  }
</style>
