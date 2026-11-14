/** Drawing a scene as standalone SVG in a color theme. */

import { type Point, type Scene, type SceneShape, type SceneText, STACK } from "./scene.ts";
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
}

/** Mix two `#rrggbb` colors; `weight` is the share of `a`. */
export function mix(a: string, b: string, weight: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
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
  const tone = tones(colors);
  const { ink, line, boundary } = tone;
  // A color tints leaves lightly and containers one step deeper per level, as their neutral shades do.
  const fillOf = (shape: SceneShape) =>
    shape.fill === "page"
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
            ? ink
            : "none";
  // The color behind a point: the innermost filled container around it, or the page.
  const containers = scene.shapes
    .filter((shape) => shape.container && shape.fill !== "none")
    .toSorted((a, b) => b.depth - a.depth);
  const behind = (point: Point) => {
    const shape = containers.find(
      (item) =>
        point.x >= item.box.x &&
        point.x <= item.box.x + item.box.width &&
        point.y >= item.box.y &&
        point.y <= item.box.y + item.box.height,
    );
    return shape ? fillOf(shape) : colors.background;
  };
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const textColors = {
    text: colors.text,
    secondary: colors.secondary,
    ink,
    inverse: colors.background,
  };

  const icon = (shape: SceneShape) => {
    const { x, y, width } = shape.box;
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
  };
  // A stacked shape (multiplicity) has a second outline behind it.
  const shapeSvg = (shape: SceneShape): string =>
    (shape.stack
      ? outlineSvg({
          ...shape,
          box: { ...shape.box, x: shape.box.x + STACK, y: shape.box.y + STACK },
        })
      : "") +
    outlineSvg(shape) +
    icon(shape);
  const outlineSvg = (shape: SceneShape): string => {
    const { x, y, width: w, height: h } = shape.box,
      fill = fillOf(shape);
    const stroke = `stroke="${ink}" stroke-width="${shape.thin ? 1 : 1.5}"${shape.dashed ? ' stroke-dasharray="5 4"' : ""}`;
    const poly = (points: [number, number][]) =>
      `<path d="${points.map(([px, py], index) => `${index ? "L" : "M"}${round1(px)} ${round1(py)}`).join("")}Z" fill="${fill}" ${stroke} stroke-linejoin="round"/>`;
    const cx = x + w / 2,
      cy = y + h / 2;
    const dividers = (shape.dividers ?? [])
      .map(
        (at) =>
          `<path d="M${round1(x)} ${round1(at)}H${round1(x + w)}" stroke="${ink}" stroke-width="${shape.thin ? 1 : 1.2}"/>`,
      )
      .join("");
    switch (shape.kind) {
      case "region":
        return "";
      case "rect":
      case "activation":
        return (
          `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" fill="${fill}" ${shape.kind === "activation" ? `stroke="${ink}" stroke-width="1"` : stroke}/>` +
          dividers
        );
      case "round":
      case "stadium": {
        const radius =
          shape.kind === "stadium" ? h / 2 : Math.min(shape.radius ?? 10, h / 2, w / 2);
        return (
          `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" rx="${round1(radius)}" fill="${fill}" ${stroke}/>` +
          dividers
        );
      }
      case "ellipse":
        return `<ellipse cx="${round1(cx)}" cy="${round1(cy)}" rx="${round1(w / 2)}" ry="${round1(h / 2)}" fill="${fill}" ${stroke}/>`;
      case "circle":
        return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(Math.min(w, h) / 2)}" fill="${fill}" ${stroke}/>`;
      case "double-circle": {
        const radius = Math.min(w, h) / 2;
        return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius)}" fill="${fill}" ${stroke}/><circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 4)}" fill="none" ${stroke}/>`;
      }
      case "diamond":
        return poly([
          [cx, y],
          [x + w, cy],
          [cx, y + h],
          [x, cy],
        ]);
      case "hexagon":
      case "lean-right":
      case "lean-left":
      case "trapezoid":
      case "trapezoid-top":
      case "flag":
        return poly(polygonOf(shape.kind, shape.box).map((point) => [point.x, point.y]));
      case "subroutine":
        return `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" fill="${fill}" ${stroke}/><path d="M${round1(x + 8)} ${round1(y)}V${round1(y + h)}M${round1(x + w - 8)} ${round1(y)}V${round1(y + h)}" ${stroke}/>`;
      case "cylinder": {
        const ry = Math.min(7, h / 5),
          rx = w / 2;
        return (
          `<path d="M${round1(x)} ${round1(y + ry)}A${round1(rx)} ${round1(ry)} 0 0 1 ${round1(x + w)} ${round1(y + ry)}V${round1(y + h - ry)}A${round1(rx)} ${round1(ry)} 0 0 1 ${round1(x)} ${round1(y + h - ry)}Z" fill="${fill}" ${stroke}/>` +
          `<path d="M${round1(x)} ${round1(y + ry)}A${round1(rx)} ${round1(ry)} 0 0 0 ${round1(x + w)} ${round1(y + ry)}" fill="none" ${stroke}/>`
        );
      }
      case "note": {
        const fold = Math.min(10, h / 2);
        return (
          `<path d="M${round1(x)} ${round1(y)}H${round1(x + w - fold)}L${round1(x + w)} ${round1(y + fold)}V${round1(y + h)}H${round1(x)}Z" fill="${fill}" ${stroke} stroke-linejoin="round"/>` +
          `<path d="M${round1(x + w - fold)} ${round1(y)}V${round1(y + fold)}H${round1(x + w)}" fill="none" ${stroke} stroke-linejoin="round"/>`
        );
      }
      case "destroy":
        return `<path d="M${round1(x)} ${round1(y)}L${round1(x + w)} ${round1(y + h)}M${round1(x)} ${round1(y + h)}L${round1(x + w)} ${round1(y)}" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
      case "bar":
        return `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" rx="1.5" fill="${ink}"/>`;
      case "initial":
        return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(Math.min(w, h) / 2)}" fill="${ink}"/>`;
      case "badge":
        return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(Math.min(w, h) / 2)}" fill="${ink}"/>`;
      case "final": {
        const radius = Math.min(w, h) / 2;
        return `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 0.75)}" fill="${colors.background}" stroke="${ink}" stroke-width="1.5"/><circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius - 4.5)}" fill="${ink}"/>`;
      }
      case "flow-final": {
        const radius = Math.min(w, h) / 2 - 0.75,
          k = radius * 0.7;
        return (
          `<circle cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(radius)}" fill="${colors.background}" stroke="${ink}" stroke-width="1.5"/>` +
          `<path d="M${round1(cx - k)} ${round1(cy - k)}L${round1(cx + k)} ${round1(cy + k)}M${round1(cx - k)} ${round1(cy + k)}L${round1(cx + k)} ${round1(cy - k)}" stroke="${ink}" stroke-width="1.5"/>`
        );
      }
      case "actor": {
        // A stick figure filling the box (or its `tab` area at the top, with the name below): head, body, arms and legs.
        if (shape.tab)
          return shapeSvg({
            ...shape,
            box: {
              x: cx - shape.tab.width / 2,
              y,
              width: shape.tab.width,
              height: shape.tab.height,
            },
            tab: undefined,
          });
        const head = Math.min(w * 0.22, h * 0.13),
          top = y + head + 1,
          neck = top + head,
          hip = y + h * 0.62,
          arms = neck + (hip - neck) * 0.3;
        return (
          `<g fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="${round1(cx)}" cy="${round1(top)}" r="${round1(head)}" fill="${colors.background}"/>` +
          `<path d="M${round1(cx)} ${round1(neck)}V${round1(hip)}M${round1(x + 1)} ${round1(arms)}H${round1(x + w - 1)}M${round1(x + 2)} ${round1(y + h - 1)}L${round1(cx)} ${round1(hip)}L${round1(x + w - 2)} ${round1(y + h - 1)}"/></g>`
        );
      }
      case "folder": {
        const tab = shape.tab ?? { width: 40, height: 20 };
        return (
          `<path d="M${round1(x)} ${round1(y + tab.height)}V${round1(y)}H${round1(x + tab.width)}V${round1(y + tab.height)}" fill="${fill}" ${stroke}/>` +
          `<rect x="${round1(x)}" y="${round1(y + tab.height)}" width="${round1(w)}" height="${round1(h - tab.height)}" fill="${fill}" ${stroke}/>`
        );
      }
      case "pointer": {
        const d = shape.facing ?? { x: 1, y: 0 },
          tip = { x: cx + d.x * 3.5, y: cy + d.y * 3.5 },
          base = { x: cx - d.x * 3, y: cy - d.y * 3 };
        return `<path d="M${round1(tip.x)} ${round1(tip.y)}L${round1(base.x - d.y * 3.5)} ${round1(base.y + d.x * 3.5)}L${round1(base.x + d.y * 3.5)} ${round1(base.y - d.x * 3.5)}Z" fill="${ink}"/>`;
      }
      case "dots": {
        // Along the longer side; each dot cuts a small gap into any line under it.
        const across = w >= h,
          gap = behind({ x: cx, y: cy });
        return [-6, 0, 6]
          .map(
            (step) =>
              `<circle cx="${round1(cx + (across ? step : 0))}" cy="${round1(cy + (across ? 0 : step))}" r="1.8" fill="${ink}" stroke="${gap}" stroke-width="6" paint-order="stroke"/>`,
          )
          .join("");
      }
      case "frame": {
        const tab = shape.tab;
        return (
          `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(w)}" height="${round1(h)}" fill="${fill}" stroke="${ink}" stroke-width="1"/>` +
          (tab
            ? `<path d="M${round1(x)} ${round1(y + tab.height)}H${round1(x + tab.width - 6)}L${round1(x + tab.width)} ${round1(y + tab.height - 6)}V${round1(y)}" fill="none" stroke="${ink}" stroke-width="1"/>`
            : "")
        );
      }
    }
  };
  const text = (item: SceneText) => {
    // Text over connections gets a halo in the color behind it, so crossing lines stop short of the glyphs.
    const owner = item.owner ? shapes.get(item.owner) : undefined;
    // A frame without fill (a group) shows what is behind its title.
    const halo =
      (item.role === "title" || item.role === "stereotype") && owner?.container
        ? owner.fill === "none"
          ? behind({ x: item.box.x + item.box.width / 2, y: item.box.y + item.box.height / 2 })
          : fillOf(owner)
        : item.halo === "background"
          ? behind({ x: item.box.x + item.box.width / 2, y: item.box.y + item.box.height / 2 })
          : undefined;
    const anchor =
      item.anchor === "start"
        ? ""
        : item.anchor === "end"
          ? ' text-anchor="end"'
          : ' text-anchor="middle"';
    return (
      `<text x="${round1(item.x)}" y="${round1(item.y + item.size * 0.35)}" font-size="${item.size}"${item.weight !== 400 ? ` font-weight="${item.weight}"` : ""}${anchor}` +
      `${item.tone === "text" ? "" : ` style="fill:${textColors[item.tone]}"`}${item.italic ? ' font-style="italic"' : ""}${item.underline ? ' text-decoration="underline"' : ""}` +
      // Labels that sit on lines get a wider halo, so the line clearly stops before the text.
      `${halo && halo !== "none" ? ` stroke="${halo}" stroke-width="${item.role === "label" || item.role === "end" || item.role === "marker" || item.role === "protocol" ? 7 : 4}" stroke-linejoin="round" paint-order="stroke"` : ""}>${escape(item.text)}</text>`
    );
  };
  // A wire's stroke stops inside the markers at its ends, so it never shows through a head's tip.
  const trimmed = (wire: Scene["wires"][number]) => {
    const points = wire.points.map((point) => ({ ...point }));
    for (const marker of scene.markers) {
      if (marker.wire !== wire.edge || !MARKER_TRIM[marker.kind]) continue;
      const end =
        Math.hypot(marker.tip.x - points[0].x, marker.tip.y - points[0].y) < 0.75
          ? 0
          : Math.hypot(marker.tip.x - points.at(-1)!.x, marker.tip.y - points.at(-1)!.y) < 0.75
            ? points.length - 1
            : -1;
      if (end < 0) continue;
      const next = points[end === 0 ? 1 : end - 1],
        length = Math.hypot(next.x - points[end].x, next.y - points[end].y);
      const cut = Math.min(MARKER_TRIM[marker.kind] * (marker.small ? 0.8 : 1), length - 0.5);
      if (cut <= 0) continue;
      points[end] = {
        x: points[end].x + ((next.x - points[end].x) / length) * cut,
        y: points[end].y + ((next.y - points[end].y) / length) * cut,
      };
    }
    return points;
  };
  const polyline = (points: Point[]) =>
    points
      .map((point, index) => `${index ? "L" : "M"}${round1(point.x)} ${round1(point.y)}`)
      .join("");
  const lineColors = { ink, line, boundary };

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
        `<path d="${wire.path ?? polyline(trimmed(wire))}" fill="none" stroke="${line}" stroke-width="${wire.thick ? 2.6 : 1.3}"${wire.dashed ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`,
    ),
    ...scene.shapes.filter((shape) => !shape.container).map(shapeSvg),
    ...scene.markers.map((marker) =>
      markerSvg(marker.kind, marker.tip, marker.direction, ink, behind(marker.tip), marker.small),
    ),
    ...scene.texts.map(text),
  ];
  const { x, y, width, height } = scene.bounds;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img" aria-roledescription="${escape(kind)}">` +
    `<title>${escape(description)}</title><style>text{font-family:${escape(colors.font)};fill:${colors.text}}</style>` +
    parts.join("") +
    "</svg>"
  );
}
