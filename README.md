# tam-diagrams

Lays out and draws [SAP TAM](https://www.fmc-modeling.org/download/fmc-and-tam/SAP-TAM_Standard.pdf)
block diagrams and the UML class, use case, activity, state machine and sequence diagrams of
[Mermaid](https://mermaid.js.org) as standalone SVG, all in one style. Layout uses
[elkjs](https://github.com/kieler/elkjs), the only dependency.

| Diagram                                    | Source                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| TAM block (component) and package diagrams | the `tam` syntax (agents, storages, channels, accesses)                |
| Class diagram                              | Mermaid `classDiagram`                                                 |
| Use case diagram                           | Mermaid `usecase-beta`                                                 |
| Activity diagram                           | Mermaid `flowchart` / `graph`; `swimlane-beta` with one lane per agent |
| State machine diagram                      | Mermaid `stateDiagram-v2`                                              |
| Sequence diagram                           | Mermaid `sequenceDiagram`                                              |

## Use

```ts
import { renderTam, renderUml, detectUml, svgUrl } from "tam-diagrams";

const colors = {
  background: "#fff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: "system-ui",
  dark: false,
};

const { svg, width, height } = await renderTam(
  "agent api[API]\nstorage db[Orders]\napi -- reads/writes --> db",
  colors,
);
if (detectUml(source)) ({ svg } = await renderUml(source, colors));
img.src = svgUrl(svg);
```

- **Errors.** Invalid sources throw `TamError` or `UmlError` with the line. A `UmlError` marked
  `unsupported` means valid Mermaid this package does not draw (ER, pie, ...): hand those to Mermaid.js.
- **Class diagrams to explore.** `renderClassView(source, colors, view)` draws a class diagram with
  some packages collapsed into folders and some classes without members; with `view` null it uses
  `overview(diagram)`, which folds a large diagram to its packages and class names. On the result,
  `classPartAt(picture.diagram, picture.view, picture.scene, point)` names the class or package at a
  point, `toggleClassPart(view, part)` opens or closes it, and `classPartBox(scene, part)` says
  where it is drawn now.
- **More diagram types.** The building blocks of the layouts (ELK graph layout, wire and label
  placement, the scene model, layout checks, the best-of-several-strategies search, Mermaid source
  preparation) are exported from `tam-diagrams/layout`.
- **Workers.** Each diagram is laid out several ways and the best layout is kept. By default ELK runs
  in-process. In a browser, pass `{ layout: await elkWorkerPool(url) }` to run the layouts in parallel
  web workers; `url` is where elkjs's `lib/elk-worker.min.js` is served (with Vite:
  `import url from "elkjs/lib/elk-worker.min.js?url"`).
- **Caching.** Layouts are cached by source and font, so a theme change only redraws.
- **Showing the result.** `svgUrl(svg)` gives a `data:` URL for an `<img>`; never insert the SVG into
  the page.
- **Text metrics.** Rendering measures text with a canvas. Without one (Node), pass
  `{ measure }` to `renderUml`, or run under jsdom as the tests do.

The package ships TypeScript sources: use it with a bundler or runtime that compiles TypeScript
(Vite, esbuild, Bun, Deno, Node 23+ with type stripping).

## API

- `tam-diagrams`: `renderTam`, `parseTam`, `TamError`; `renderUml`, `parseUml`, `detectUml`,
  `UmlError`; `renderClassView`, `overview`, `classPartAt`, `classPartBox`, `toggleClassPart`;
  `drawScene`, `textMeasure`, `auditScene`, `measureScene`, `svgUrl`; `elkWorkerPool`,
  `bundledElk`; and their types.
- `tam-diagrams/layout`: building blocks for further diagram types (`layoutGraph`, `addWire`,
  `attachEnds`, `hugLabels`, `straightenScene`, `bestScene`, scene helpers, `prepare`, ...) and the
  TAM layout steps (`layoutTam`, `bestLayout`).
- `tam-diagrams/samples/tam-examples`, `tam-diagrams/samples/uml-examples`: example sources.
- `tam-diagrams/samples/fuzz`: seeded generators of random diagrams, for tests and stress runs.

## TAM syntax

```tam
title Order system
direction LR
human customer[Customer]
agent shop[Web Shop] {
  agent api[Order API]
  storage cart[Cart]
}
storage db[(Orders)]
customer -- HTTPS --> api
api -- reads/writes --> cart
api -- writes --> db
```

An **agent** (rectangle) does something; a **human** is an agent that is a person. A **storage**
(rounded) keeps information. Agents talk through **channels** (`a -- protocol --> b`) and use
storages through **accesses** (`reads`, `writes`, `reads/writes`). A storage is never joined to a
storage by a flow, only by a `pointer`. Containers draw their parts inside; `group` frames elements.
`package` elements with `-. use .->` and `-. import .->` make package diagrams. The parser enforces
these rules and reports the line of a broken one.

## Files

| File                         | Contents                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `src/index.ts`               | Public API: `renderTam`, `renderUml`, `renderClassView` and the UML type dispatch    |
| `src/layout.ts`              | The `tam-diagrams/layout` entry point: building blocks for further diagram types     |
| `src/tam.ts`                 | TAM block and package diagrams: the parser                                           |
| `src/tam-rows.ts`            | TAM multiplicity: multiple elements as rows of copies, with dots and pointers        |
| `src/tam-layout.ts`          | TAM layout entry: `layoutTam` runs the three stages; strategies and rendering        |
| `src/tam-graph.ts`           | TAM layout stage 1: sizes, channel and connector nodes, the ELK graph                |
| `src/tam-geometry.ts`        | TAM layout stage 2: ELK's result read back, then the geometry passes                 |
| `src/tam-scene.ts`           | TAM layout stage 3: the scene drawn from the final geometry                          |
| `src/tam-protocols.ts`       | TAM protocol boundaries: dashed lines through the channels of one protocol           |
| `src/uml.ts`                 | What the UML parsers share: type detection, errors, source preparation, vertex ports |
| `src/uml-class.ts`           | Class diagrams: the parser, and the views and hit tests of the class explorer        |
| `src/uml-class-layout.ts`    | Class diagram layout: compartments, notes, lollipops and self relations              |
| `src/uml-class-packages.ts`  | Class diagram packages side by side, end labels and merged inheritance trees         |
| `src/uml-usecase.ts`         | Use case diagrams: the parser                                                        |
| `src/uml-usecase-layout.ts`  | Use case layout: actors and use cases in columns inside their system boundaries      |
| `src/uml-usecase-lines.ts`   | Use case lines: straight or curved links and loops                                   |
| `src/uml-usecase-label.ts`   | Use case line labels: beside the middle of the line, on the side with room           |
| `src/uml-activity.ts`        | Flowcharts and activity diagrams: the parser                                         |
| `src/uml-activity-layout.ts` | Flowchart layout with ELK and the node shapes swimlanes share                        |
| `src/uml-swimlanes.ts`       | Swimlane activity diagrams: `layoutSwimlanes` and the drawing                        |
| `src/swimlane-place.ts`      | Swimlanes stage 1: lanes, rows and items sized and placed                            |
| `src/swimlane-routes.ts`     | Swimlanes stage 2: the grid router, wire labels and guards                           |
| `src/uml-state.ts`           | State machine diagrams: the parser                                                   |
| `src/uml-state-layout.ts`    | State machine layout: composite states, concurrent regions, notes                    |
| `src/uml-sequence.ts`        | Sequence diagrams: the parser                                                        |
| `src/uml-sequence-layout.ts` | Sequence layout: messages, activation bars, frames and notes                         |
| `src/uml-sequence-lanes.ts`  | Sequence lanes: participant headers and the column solver                            |
| `src/lane-frames.ts`         | Frames across lanes (fragments, regions), guards, notes, labels beside connections   |
| `src/scene.ts`               | The scene model all layouts produce and its box and point geometry                   |
| `src/outline.ts`             | Shape outlines: polygons, inside tests, where wires enter shapes                     |
| `src/text.ts`                | Type scale, text measuring and wrapping, text, titles, notes and scene bounds        |
| `src/markers.ts`             | Wire-end markers: size, outline and SVG                                              |
| `src/draw.ts`                | The SVG drawer and color tones                                                       |
| `src/elk.ts`                 | ELK layout of nested graphs and the worker pool                                      |
| `src/wires.ts`               | Wires from ELK's routes: ends, spreading and straightening                           |
| `src/labels.ts`              | Label placement beside wires and shapes                                              |
| `src/route.ts`               | Geometry passes after ELK: shared state, segment and clearance helpers               |
| `src/route-straighten.ts`    | Passes that straighten wires and slide markers                                       |
| `src/route-center.ts`        | Passes that center elements, fans, pairs and ends                                    |
| `src/route-spread.ts`        | Passes that spread jogs and balance elements                                         |
| `src/audit.ts`               | Layout checks: overlaps, wires through shapes, ...                                   |
| `src/best.ts`                | Scene metrics, the best-layout portfolio and the layout cache                        |
| `test/`                      | Tests; `tam.fuzz.test.ts` is a stress run gated by `HARNESS=1`                       |

## Checks

`npm install && npm test` runs the tests: every sample must render with no audit defects, and the
Mermaid samples must also parse with Mermaid. To stress-test with generated diagrams:
`HARNESS=1 COUNT=200 OUT=/tmp/fuzz.json npx vitest run test/tam.fuzz.test.ts`.

## License

MIT
