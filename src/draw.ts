/** Drawing a scene as standalone SVG in a color theme. */

import {
  contains,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
  type ShapeKind,
  STACK,
} from "./scene.ts";
import { MARKER_TRIM, markerSvg, round1 } from "./markers.ts";
import { polygonOf } from "./outline.ts";

/**
 * Shared drawing primitives of the house diagram style (introduced by the TAM block diagram
 * renderer): palette mixing, the ink / wire / boundary tones, text measuring and wrapping, and
 * arrowheads. UML diagram renderers use these; the TAM renderer can switch over to them.
 */

/** Colors a renderer needs; MermaidDiagram's `Palette` and TAM's colors both satisfy it. */
export interface DiagramColors {
  background: string;
  text: string;
  secondary: string;
  series: string[];
  font: string;
  dark: boolean;
  /** Connections bend round at their corners, as draw.io rounds them; square corners without it. */
  rounded?: boolean;
}

/** `#rgb` as `#rrggbb`; throws for any other color. */
const expandHex = (hex: string) => {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex))
    throw new Error(`Cannot mix the color \`${hex}\`: colors are mixed as #rgb or #rrggbb.`);
  return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}` : hex;
};

/**
 * Mix two `#rrggbb` or `#rgb` colors; `weight` is the share of `a`. Any other form (`#rrggbbaa`,
 * `rgb()`, a name) throws an Error naming the first one, instead of drawing a broken fill.
 */
export function mix(a: string, b: string, weight: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((index) => parseInt(expandHex(hex).slice(index, index + 2), 16));
  const [left, right] = [channels(a), channels(b)];
  return `#${left
    .map((value, index) =>
      Math.round(value * weight + right[index] * (1 - weight))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The tones derived from the page and text colors, as in TAM block diagrams. */
export function tones(colors: DiagramColors) {
  const { text, background, dark } = colors;
  return {
    /** Outlines and filled marks: strong, as in FMC. */
    ink: mix(text, background, 0.9),
    /** Connections. */
    line: mix(text, background, 0.7),
    /** Dashed boundaries, lifelines and lane separators. */
    boundary: mix(text, background, 0.62),
    /** Container fill at nesting depth `depth` (0 = outermost). */
    shade: (depth: number) => mix(text, background, (dark ? 0.07 : 0.05) + 0.035 * depth),
    /** Activation bars on lifelines and other emphasized fills. */
    strong: mix(text, background, dark ? 0.3 : 0.2),
  };
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Palette color names map onto the shared categorical series; gray is a neutral mix of the text color instead. */
const SERIES: Record<string, number> = {
  blue: 0,
  orange: 1,
  green: 2,
  yellow: 3,
  pink: 4,
  purple: 6,
  red: 7,
};

/** A named color mixed into the page color; `weight` is the color's share. */
function tint(colors: DiagramColors, name: string, weight: number): string {
  return name === "gray"
    ? mix(colors.text, colors.background, weight * 0.7)
    : mix(colors.series[SERIES[name]] ?? colors.series[0], colors.background, weight);
}

/** How far a rounded corner reaches along each leg, as draw.io rounds connectors (arcSize 20). */
const CORNER = 10;

/**
 * A polyline with its corners bent round: each corner becomes a curve that starts and ends CORNER
 * along its legs, or halfway along a shorter leg; straight runs through a point stay straight.
 */
export function roundedPath(points: Point[]): string {
  if (points.length < 3)
    return points.map((p, i) => `${i ? "L" : "M"}${round1(p.x)} ${round1(p.y)}`).join("");
  let d = `M${round1(points[0].x)} ${round1(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, q, n] = [points[i - 1], points[i], points[i + 1]];
    const before = Math.hypot(q.x - p.x, q.y - p.y),
      after = Math.hypot(n.x - q.x, n.y - q.y);
    const turn = (q.x - p.x) * (n.y - q.y) - (q.y - p.y) * (n.x - q.x);
    if (!before || !after || Math.abs(turn) < 0.01 * before * after) {
      d += `L${round1(q.x)} ${round1(q.y)}`;
      continue;
    }
    const radius = Math.min(CORNER, before / 2, after / 2);
    const a = {
        x: q.x - ((q.x - p.x) / before) * radius,
        y: q.y - ((q.y - p.y) / before) * radius,
      },
      b = { x: q.x + ((n.x - q.x) / after) * radius, y: q.y + ((n.y - q.y) / after) * radius };
    d += `L${round1(a.x)} ${round1(a.y)}Q${round1(q.x)} ${round1(q.y)} ${round1(b.x)} ${round1(b.y)}`;
  }
  const last = points.at(-1)!;
  return `${d}L${round1(last.x)} ${round1(last.y)}`;
}

/** The fill of a shape in a theme: a color tints leaves lightly and containers one step deeper per level, as their neutral shades do. */
export function shapeFill(shape: SceneShape, colors: DiagramColors): string {
  const tone = tones(colors);
  return shape.fill === "page"
    ? shape.color
      ? tint(colors, shape.color, colors.dark ? 0.3 : 0.16)
      : colors.background
    : shape.fill === "shade"
      ? shape.color
        ? tint(colors, shape.color, (colors.dark ? 0.2 : 0.12) + 0.06 * shape.depth)
        : tone.shade(shape.depth)
      : shape.fill === "strong"
        ? tone.strong
        : shape.fill === "ink"
          ? tone.ink
          : "none";
}

/**
 * Draws a scene as standalone SVG in the house style of TAM block diagrams:
 * shapes on the page color with ink outlines, containers one shade deeper per level, darker wires,
 * notched arrowheads, and text halos in the color behind them.
 */
export function drawScene(
  scene: Scene,
  colors: DiagramColors,
  description: string,
  kind = "diagram",
): string {
  const painter = painterOf(scene, colors);
  const { line, boundary, ink } = painter;
  const lineColors = { ink, line, boundary };
  const shapeSvg = (shape: SceneShape) => drawShape(painter, shape);
  /** A wire's path: a polyline, its corners bent round when the colors ask for it. */
  const wirePath = (points: Point[]) => (colors.rounded ? roundedPath(points) : polyline(points));

  // Paint order: containers outside-in, lines, wires, leaves, markers, text on top.
  const parts = [
    ...scene.shapes
      .filter((shape) => shape.container)
      .toSorted((a, b) => a.depth - b.depth)
      .map(shapeSvg),
    ...scene.lines.map(
      (item) =>
        `<path d="${polyline(item.points)}" fill="none" stroke="${lineColors[item.tone]}" stroke-width="${item.width}"${item.dashed ? ' stroke-dasharray="6 4"' : ""}/>`,
    ),
    ...scene.wires.map(
      (wire) =>
        `<path d="${wire.path ?? wirePath(trimmed(scene, wire))}" fill="none" stroke="${line}" stroke-width="${wire.thick ? 2.6 : 1.3}"${wire.dashed ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`,
    ),
    ...scene.shapes.filter((shape) => !shape.container).map(shapeSvg),
    ...scene.markers.map((marker) =>
      markerSvg(
        marker.kind,
        marker.tip,
        marker.direction,
        ink,
        painter.behind(marker.tip),
        marker.small,
      ),
    ),
    ...scene.texts.map((item) => textSvg(painter, item)),
  ];
  const { x, y, width, height } = scene.bounds;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img" aria-roledescription="${escape(kind)}">` +
    `<title>${escape(description)}</title><style>text{font-family:${escape(colors.font)};fill:${colors.text}}</style>` +
    parts.join("") +
    "</svg>"
  );
}

/** What drawing the parts of a scene needs: the theme and its tones, the shapes by id, and the color behind any point. */
interface Painter {
  colors: DiagramColors;
  ink: string;
  line: string;
  boundary: string;
  shapes: Map<string, SceneShape>;
  behind: (point: Point) => string;
}

function painterOf(scene: Scene, colors: DiagramColors): Painter {
  const { ink, line, boundary } = tones(colors);
  // The color behind a point: the innermost filled container around it, or the page.
  const containers = scene.shapes
    .filter((shape) => shape.container && shape.fill !== "none")
    .toSorted((a, b) => b.depth - a.depth);
  const behind = (point: Point) => {
    const shape = containers.find((item) => contains(item.box, point));
    return shape ? shapeFill(shape, colors) : colors.background;
  };
  return {
    colors,
    ink,
    line,
    boundary,
    shapes: new Map(scene.shapes.map((shape) => [shape.id, shape])),
    behind,
  };
}

/** The icon in the corner of a component, or the stick figure at the top of a human agent. */
function icon(painter: Painter, shape: SceneShape) {
  const { x, y, width } = shape.box,
    { ink, colors } = painter;
  if (shape.icon === "component") {
    const left = x + width - 21,
      top = y + 8;
    return `<g fill="${colors.background}" stroke="${ink}" stroke-width="1"><rect x="${round1(left + 3)}" y="${round1(top)}" width="11" height="13"/><rect x="${round1(left)}" y="${round1(top + 2.5)}" width="6" height="3"/><rect x="${round1(left)}" y="${round1(top + 7.5)}" width="6" height="3"/></g>`;
  }
  if (shape.icon === "human") {
    const cx = x + width / 2,
      top = y + 8;
    return `<g fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"><circle cx="${round1(cx)}" cy="${round1(top + 5)}" r="4.5"/><path d="M${round1(cx)} ${round1(top + 9.5)}V${round1(top + 20)}M${round1(cx - 8)} ${round1(top + 13.5)}H${round1(cx + 8)}M${round1(cx - 6.5)} ${round1(top + 29)}L${round1(cx)} ${round1(top + 20)}L${round1(cx + 6.5)} ${round1(top + 29)}"/></g>`;
  }
  return "";
}

/** A shape with its icon; a stacked shape (multiplicity) has a second outline behind it. */
function drawShape(painter: Painter, shape: SceneShape): string {
  const behind = shape.stack
    ? outlineSvg(painter, {
        ...shape,
        box: { ...shape.box, x: shape.box.x + STACK, y: shape.box.y + STACK },
      })
    : "";
  return behind + outlineSvg(painter, shape) + icon(painter, shape);
}

/** A shape as its outline is drawn: its box and middle, its fill and stroke, in the painter's tones. */
interface Outline {
  painter: Painter;
  shape: SceneShape;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  fill: string;
  stroke: string;
}

/** The outline of a shape, by its kind. */
function outlineSvg(painter: Painter, shape: SceneShape): string {
  const { x, y, width: w, height: h } = shape.box;
  const stroke = `stroke="${painter.ink}" stroke-width="${shape.thin ? 1 : 1.5}"${shape.dashed ? ' stroke-dasharray="5 4"' : ""}`;
  return OUTLINES[shape.kind]({
    painter,
    shape,
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
    fill: shapeFill(shape, painter.colors),
    stroke,
  });
}

/** A closed polygon through `points`, filled and stroked as its shape. */
const poly = ({ fill, stroke }: Outline, points: [number, number][]) =>
  `<path d="${points.map(([px, py], index) => `${index ? "L" : "M"}${round1(px)} ${round1(py)}`).join("")}Z" fill="${fill}" ${stroke} stroke-linejoin="round"/>`;

/** The lines that divide a class's box into its compartments. */
const dividers = ({ shape, x, w, painter }: Outline) =>
  (shape.dividers ?? [])
    .map(
      (at) =>
        `<path d="M${round1(x)} ${round1(at)}H${round1(x + w)}" stroke="${painter.ink}" stroke-width="${shape.thin ? 1 : 1.2}"/>`,
    )
    .join("");

const rect = (o: Outline) =>
  `<rect x="${round1(o.x)}" y="${round1(o.y)}" width="${round1(o.w)}" height="${round1(o.h)}" fill="${o.fill}" ${o.shape.kind === "activation" ? `stroke="${o.painter.ink}" stroke-width="1"` : o.stroke}/>` +
  dividers(o);

function roundRect(o: Outline) {
  const { shape, x, y, w, h } = o;
  const radius = shape.kind === "stadium" ? h / 2 : Math.min(shape.radius ?? 10, h / 2, w / 2);
  return (
    `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" rx="${round1(radius)}" fill="${o.fill}" ${o.stroke}/>` +
    dividers(o)
  );
}

const polygon = (o: Outline) =>
  poly(
    o,
    polygonOf(o.shape.kind, o.shape.box).map((point) => [point.x, point.y]),
  );

/** A filled dot as large as the box: the start of an activity, a sequence number's badge. */
const dot = ({ cx, cy, w, h, painter }: Outline) =>
  `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(Math.min(w, h) / 2)}" fill="${painter.ink}"/>`;

/** An outline filled as its shape, with a line of its outline drawn over it: a cylinder's rim, a note's fold. */
const withLine = ({ fill, stroke }: Outline, outline: string, line: string, joins = "") =>
  `<path d="${outline}" fill="${fill}" ${stroke}${joins}/><path d="${line}" fill="none" ${stroke}${joins}/>`;

function cylinder(o: Outline) {
  const { x, y, w, h } = o,
    ry = Math.min(7, h / 5),
    rx = w / 2;
  return withLine(
    o,
    `M${round1(x)} ${round1(y + ry)}A${round1(rx)} ${round1(ry)} 0 0 1 ${round1(x + w)} ${round1(y + ry)}V${round1(y + h - ry)}A${round1(rx)} ${round1(ry)} 0 0 1 ${round1(x)} ${round1(y + h - ry)}Z`,
    `M${round1(x)} ${round1(y + ry)}A${round1(rx)} ${round1(ry)} 0 0 0 ${round1(x + w)} ${round1(y + ry)}`,
  );
}

function note(o: Outline) {
  const { x, y, w, h } = o,
    fold = Math.min(10, h / 2);
  return withLine(
    o,
    `M${round1(x)} ${round1(y)}H${round1(x + w - fold)}L${round1(x + w)} ${round1(y + fold)}V${round1(y + h)}H${round1(x)}Z`,
    `M${round1(x + w - fold)} ${round1(y)}V${round1(y + fold)}H${round1(x + w)}`,
    ' stroke-linejoin="round"',
  );
}

function final({ cx, cy, w, h, painter }: Outline) {
  const radius = Math.min(w, h) / 2;
  return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 0.75)}" fill="${painter.colors.background}" stroke="${painter.ink}" stroke-width="1.5"/><circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 4.5)}" fill="${painter.ink}"/>`;
}

function flowFinal({ cx, cy, w, h, painter }: Outline) {
  const radius = Math.min(w, h) / 2 - 0.75,
    k = radius * 0.7;
  return (
    `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius)}" fill="${painter.colors.background}" stroke="${painter.ink}" stroke-width="1.5"/>` +
    `<path d="M${round1(cx - k)} ${round1(cy - k)}L${round1(cx + k)} ${round1(cy + k)}M${round1(cx - k)} ${round1(cy + k)}L${round1(cx + k)} ${round1(cy - k)}" stroke="${painter.ink}" stroke-width="1.5"/>`
  );
}

/** A stick figure filling the box (or its `tab` area at the top, with the name below): head, body, arms and legs. */
function actor({ shape, painter, x, y, w, h, cx }: Outline) {
  if (shape.tab)
    return drawShape(painter, {
      ...shape,
      box: { x: cx - shape.tab.width / 2, y, width: shape.tab.width, height: shape.tab.height },
      tab: undefined,
    });
  const head = Math.min(w * 0.22, h * 0.13),
    top = y + head + 1,
    neck = top + head,
    hip = y + h * 0.62,
    arms = neck + (hip - neck) * 0.3;
  return (
    `<g fill="none" stroke="${painter.ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="${round1(cx)}" cy="${round1(top)}" r="${round1(head)}" fill="${painter.colors.background}"/>` +
    `<path d="M${round1(cx)} ${round1(neck)}V${round1(hip)}M${round1(x + 1)} ${round1(arms)}H${round1(x + w - 1)}M${round1(x + 2)} ${round1(y + h - 1)}L${round1(cx)} ${round1(hip)}L${round1(x + w - 2)} ${round1(y + h - 1)}"/></g>`
  );
}

function folder({ shape, x, y, w, h, fill, stroke }: Outline) {
  const tab = shape.tab ?? { width: 40, height: 20 };
  return (
    `<path d="M${round1(x)} ${round1(y + tab.height)}V${round1(y)}H${round1(x + tab.width)}V${round1(y + tab.height)}" fill="${fill}" ${stroke}/>` +
    `<rect x="${round1(x)}" y="${round1(y + tab.height)}" width="${round1(w)}" height="${round1(h - tab.height)}" fill="${fill}" ${stroke}/>`
  );
}

function pointer({ shape, cx, cy, painter }: Outline) {
  const d = shape.facing ?? { x: 1, y: 0 },
    tip = { x: cx + d.x * 3.5, y: cy + d.y * 3.5 },
    base = { x: cx - d.x * 3, y: cy - d.y * 3 };
  return `<path d="M${round1(tip.x)} ${round1(tip.y)}L${round1(base.x - d.y * 3.5)} ${round1(base.y + d.x * 3.5)}L${round1(base.x + d.y * 3.5)} ${round1(base.y - d.x * 3.5)}Z" fill="${painter.ink}"/>`;
}

/** Three dots along the longer side; each dot cuts a small gap into any line under it. */
function dots({ cx, cy, w, h, painter }: Outline) {
  const across = w >= h,
    gap = painter.behind({ x: cx, y: cy });
  return [-6, 0, 6]
    .map(
      (step) =>
        `<circle cx="${round1(cx + (across ? step : 0))}" cy="${round1(cy + (across ? 0 : step))}" r="1.8" fill="${painter.ink}" stroke="${gap}" stroke-width="6" paint-order="stroke"/>`,
    )
    .join("");
}

function frame({ shape, x, y, w, h, fill, painter }: Outline) {
  const tab = shape.tab,
    { ink } = painter;
  return (
    `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" fill="${fill}" stroke="${ink}" stroke-width="1"/>` +
    (tab
      ? `<path d="M${round1(x)} ${round1(y + tab.height)}H${round1(x + tab.width - 6)}L${round1(x + tab.width)} ${round1(y + tab.height - 6)}V${round1(y)}" fill="none" stroke="${ink}" stroke-width="1"/>`
      : "")
  );
}

/** How each kind of shape draws its outline. */
const OUTLINES: Record<ShapeKind, (outline: Outline) => string> = {
  region: () => "",
  rect,
  activation: rect,
  round: roundRect,
  stadium: roundRect,
  ellipse: ({ cx, cy, w, h, fill, stroke }) =>
    `<ellipse cx="${round1(cx)}" cy="${round1(cy)}" rx="${round1(w / 2)}" ry="${round1(h / 2)}" fill="${fill}" ${stroke}/>`,
  circle: ({ cx, cy, w, h, fill, stroke }) =>
    `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(Math.min(w, h) / 2)}" fill="${fill}" ${stroke}/>`,
  "double-circle": ({ cx, cy, w, h, fill, stroke }) => {
    const radius = Math.min(w, h) / 2;
    return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius)}" fill="${fill}" ${stroke}/><circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 4)}" fill="none" ${stroke}/>`;
  },
  diamond: (o) =>
    poly(o, [
      [o.cx, o.y],
      [o.x + o.w, o.cy],
      [o.cx, o.y + o.h],
      [o.x, o.cy],
    ]),
  hexagon: polygon,
  "lean-right": polygon,
  "lean-left": polygon,
  trapezoid: polygon,
  "trapezoid-top": polygon,
  flag: polygon,
  subroutine: ({ x, y, w, h, fill, stroke }) =>
    `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" fill="${fill}" ${stroke}/><path d="M${round1(x + 8)} ${round1(y)}V${round1(y + h)}M${round1(x + w - 8)} ${round1(y)}V${round1(y + h)}" ${stroke}/>`,
  cylinder,
  note,
  destroy: ({ x, y, w, h, painter }) =>
    `<path d="M${round1(x)} ${round1(y)}L${round1(x + w)} ${round1(y + h)}M${round1(x)} ${round1(y + h)}L${round1(x + w)} ${round1(y)}" stroke="${painter.ink}" stroke-width="1.6" stroke-linecap="round"/>`,
  bar: ({ x, y, w, h, painter }) =>
    `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" rx="1.5" fill="${painter.ink}"/>`,
  initial: dot,
  badge: dot,
  final,
  "flow-final": flowFinal,
  actor,
  folder,
  pointer,
  dots,
  frame,
};

/** The middle of a text's box. */
const middleOf = (item: SceneText) => ({
  x: item.box.x + item.box.width / 2,
  y: item.box.y + item.box.height / 2,
});

/**
 * The halo of a text in the color behind it, so crossing lines stop short of the glyphs: a
 * container's title takes the container's fill, and a frame without fill (a group) shows what is
 * behind its title.
 */
function haloOf(painter: Painter, item: SceneText) {
  const owner = item.owner ? painter.shapes.get(item.owner) : undefined;
  if ((item.role === "title" || item.role === "stereotype") && owner?.container)
    return owner.fill === "none"
      ? painter.behind(middleOf(item))
      : shapeFill(owner, painter.colors);
  return item.halo === "background" ? painter.behind(middleOf(item)) : undefined;
}

const ANCHORS = { start: "", end: ' text-anchor="end"', middle: ' text-anchor="middle"' };

/** Labels that sit on lines get a wider halo, so the line clearly stops before the text. */
const ON_LINES = new Set(["label", "end", "marker", "protocol"]);

/** A text's halo as stroke attributes, if it has one. */
function haloAttributes(painter: Painter, item: SceneText) {
  const halo = haloOf(painter, item);
  return halo && halo !== "none"
    ? ` stroke="${halo}" stroke-width="${ON_LINES.has(item.role ?? "") ? 7 : 4}" stroke-linejoin="round" paint-order="stroke"`
    : "";
}

/** A text's weight, tone, slant and underline as attributes, where they are not the plain ones. */
function styleAttributes(painter: Painter, item: SceneText) {
  const { colors, ink } = painter;
  const textColors = {
    text: colors.text,
    secondary: colors.secondary,
    ink,
    inverse: colors.background,
  };
  return (
    (item.tone === "text" ? "" : ` style="fill:${textColors[item.tone]}"`) +
    (item.italic ? ' font-style="italic"' : "") +
    (item.underline ? ' text-decoration="underline"' : "")
  );
}

function textSvg(painter: Painter, item: SceneText) {
  const anchor = ANCHORS[item.anchor === "start" || item.anchor === "end" ? item.anchor : "middle"];
  return (
    `<text x="${round1(item.x)}" y="${round1(item.y + item.size * 0.35)}" font-size="${item.size}"${item.weight !== 400 ? ` font-weight="${item.weight}"` : ""}${anchor}` +
    styleAttributes(painter, item) +
    `${haloAttributes(painter, item)}>${escape(item.text)}</text>`
  );
}

/** The end of a wire a marker sits on: 0, the last point's index, or -1 for neither. */
function markedEnd(points: Point[], tip: Point) {
  if (Math.hypot(tip.x - points[0].x, tip.y - points[0].y) < 0.75) return 0;
  const last = points.at(-1)!;
  return Math.hypot(tip.x - last.x, tip.y - last.y) < 0.75 ? points.length - 1 : -1;
}

/** Moves the end of a wire a marker sits on inside the marker. */
function trimEnd(points: Point[], marker: Scene["markers"][number]) {
  const end = markedEnd(points, marker.tip);
  if (end < 0) return;
  const next = points[end === 0 ? 1 : end - 1],
    length = Math.hypot(next.x - points[end].x, next.y - points[end].y);
  const cut = Math.min(MARKER_TRIM[marker.kind] * (marker.small ? 0.8 : 1), length - 0.5);
  if (cut <= 0) return;
  points[end] = {
    x: points[end].x + ((next.x - points[end].x) / length) * cut,
    y: points[end].y + ((next.y - points[end].y) / length) * cut,
  };
}

/** A wire's stroke stops inside the markers at its ends, so it never shows through a head's tip. */
function trimmed(scene: Scene, wire: Scene["wires"][number]) {
  const points = wire.points.map((point) => ({ ...point }));
  for (const marker of scene.markers)
    if (marker.wire === wire.edge && MARKER_TRIM[marker.kind]) trimEnd(points, marker);
  return points;
}

const polyline = (points: Point[]) =>
  points
    .map((point, index) => `${index ? "L" : "M"}${round1(point.x)} ${round1(point.y)}`)
    .join("");
