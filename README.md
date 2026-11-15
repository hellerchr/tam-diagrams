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
  background: "#ffffff",
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
  `renderUml` and `renderTam` (and the parsers) both raise it for a source that starts with such a type.
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
  `{ measure }` to `renderTam`, `renderUml` or `renderClassView`: `arialMeasure` is a ready measure
  for Node, or run under jsdom as the tests do.

The package ships TypeScript sources: use it with a bundler or runtime that compiles TypeScript
(Vite, esbuild, Bun, Deno). Node with type stripping (tested on Node 24) runs them from a source
checkout, but does not strip types in files under `node_modules`, so a project that installs the
package needs one of the others, or the command line, which runs from the bundled `dist/cli.js`.

## Editor

`npm run editor` serves a diagram editor (`npm run build:editor` writes it as a static page to
`dist/editor`). It edits TAM block diagrams on a canvas, and the UML types (class, use case,
activity with and without lanes, state machine, sequence) as text beside a live preview.
*File ▸ New* opens a chooser with a card for each type and its examples; the chip beside the title
says which type is on show.

In a block diagram, shapes are dragged from the Shapes tab onto the canvas, moved, resized, nested by
dropping them into a container, and connected by dragging from the dots beside an element; the
Properties section offers only the kinds and connections the notation allows there. The Outline tab
lists the elements as a tree and takes drops too. Copy, cut, paste, duplicate, undo and redo work as
usual. A moved element lines up with the edges and middles of others and with the gaps between them.
A selection is aligned, distributed, made one size, put in a box or laid out on its own from the
Arrange menu, the Properties section or a right click, which also changes what a connection is. In
the other types the Shapes tab holds snippets instead: a click adds a statement to the source.

The window has a menu bar (File, Edit, View, Arrange, Help) with the document's title, a rail with
the pointer tools, a left panel (Shapes and Outline), a right panel (Properties above Source, with a
splitter between) and a status bar with a hint, the problems of the source, the selection, the
layout mode, snapping and the zoom. The panels are resized by their inner edges and lie over the
canvas in a small window. A source with an error keeps the last valid picture on show, dimmed,
under a banner that leads to the line. Replacing the diagram (new, open, an example) is a step Undo
takes back, and asks first when there are unsaved changes.

The document is the TAM source, shown beside the canvas and editable there: every gesture is an edit
of that text, and every other line stays as its author wrote it. A source without positions is laid
out automatically, as everywhere else; moving an element writes a position for every element
(`@x,y`, see [Positions](#positions)), and *Arrange ▸ Auto layout* removes them again.

## Command line

With the package installed in a project (`npm install --save-dev tam-diagrams`, or from git),
`npx tam-diagrams` runs the command line. It tells TAM from Mermaid by content, not by file extension.

```sh
npx tam-diagrams render diagram.tam -o diagram.svg
cat diagram.tam | npx tam-diagrams render - > diagram.svg
npx tam-diagrams check docs/*.tam docs/*.mmd
```

`render` writes the SVG to the file given with `-o`, or to stdout. `check` reads every file, prints
nothing when they are valid and a `<file>:<line>: <message>` for each broken file (`<stdin>` for
`-`). To check diagram sources before each commit, add a local hook to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: tam-diagrams
        name: check diagrams
        entry: npx tam-diagrams check
        language: system
        files: \.(tam|mmd)$
```

The `files:` pattern matches whatever extensions the project uses for diagram sources.

Exit codes: `0` success, `1` a diagram error, `2` a usage or I/O error, `3` an internal error (a
bug in tam-diagrams; `check` still checks the other files). A source with no elements, such as an
empty or comment-only file, is a diagram error. The command line measures text with Arial/Helvetica
widths and names that font stack in the SVG, so the picture is exact where those fonts are installed.

## API

- `tam-diagrams`: `renderTam`, `parseTam`, `TamError`; `renderUml`, `parseUml`, `detectUml`,
  `UmlError`; `renderClassView`, `overview`, `classPartAt`, `classPartBox`, `toggleClassPart`;
  `drawScene`, `textMeasure`, `arialMeasure`, `auditScene`, `measureScene`, `svgUrl`;
  `elkWorkerPool`, `bundledElk`; and their types.
- `tam-diagrams/edit`: what an editor is built from. Edits of a source as text, each returning the
  new source: `place`, `unplace`, `pin` (positions from a layout), `addElement`, `setElement`,
  `connect`, `setConnection`, `addInterface`, `remove`, `moveInto`, `duplicate`, `copyOf`, `paste`,
  `setHeader`; and `layoutPlaced`, the synchronous layout of a placed diagram.
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
`package` elements with `-. use .->` and `-. import .->` make package diagrams.

The parser enforces the rules of the SAP TAM standard and reports the line of a broken one
(`test/tam-standard.test.ts` lists them by section):

| Rule                                                                                       | Standard      |
| ------------------------------------------------------------------------------------------ | ------------- |
| Agents hold agents, storages, subsystems, components and classes; a human holds nothing    | 3.3.4         |
| Storages hold only storages                                                                | 3.3.15        |
| Components hold components, classes and storages; subsystems also subsystems               | 2.1.1.3       |
| A channel joins agents only; components, subsystems and classes connect through interfaces | 3.3.6, 3.3.8  |
| Requests go one way or both (`<-- calls -->`); data flows one way                          | 3.3.6         |
| An access joins one active element and a storage: to it writes, from it reads              | 3.3.1         |
| A pointer joins two storages; create and generate join active elements                     | 3.3.9, 3.3.12 |
| Only agents and storages are shown as several (`stack`, `...`), dots between one kind      | 3.3.5, 3.3.11 |
| The conceptual level has agents, storages, channels and accesses only                      | 2.1.1.3       |
| Elements do not overlap: `check` and the editor say which do in a layout by hand           | 3.3.5         |

A `group` is the standard's anonymous grouping (3.3.4, 3.3.5): a thin frame that reduces the number
of channels and accesses, and counts as a storage when it holds only storages. Beyond the standard,
a group may carry a name, and `use` and `import` are plain UML dependencies. Agents and storages in
L, U or T shape are not drawn.

### Positions

An element's declaration may say where it stands: `@x,y` is its top left corner, and `WxH` after it
a size.

```tam
human customer[Customer] @40,60
agent shop[Web Shop] @220,30 380x260 {
  agent api[Order API] @250,90
  storage cart[Cart]:::blue @250,220 140x40
}
customer -- calls: place order @HTTPS --> api
api -- reads/writes --> cart
```

- Positions are absolute, in pixels, y down; nesting stays what the braces say.
- A size is a least size: an element is never smaller than its name, a container never smaller than
  its parts. A container without a position fits its parts.
- Wires are not stored. They are routed between the placed elements: straight, around one or two
  corners, or around the elements in their way.
- An element shown as several (`...`) may place its copy with a second position:
  `agent worker[Worker] ... @450,90 @450,160`. Without it the copy stands beside its original.
- One position is enough to lay the diagram out by hand; elements without one stand in a row below
  the placed ones of their container, so an element added as text shows up at once.
- A source without positions is laid out automatically, exactly as before. Positions are the only
  addition to the syntax; a protocol's `@` (inside a connection) is not one.

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
| `src/tam-placed.ts`          | TAM layout by hand: element boxes from the positions in the source (`@x,y`)          |
| `src/tam-placed-wires.ts`    | TAM layout by hand: wires between placed elements, channel circles and labels        |
| `src/tam-placed-detour.ts`   | TAM layout by hand: a wire's way around the elements between its ends                |
| `src/tam-edit.ts`            | Edits of a TAM source as text: place, add, change, connect, remove, nest, copy       |
| `src/tam-pin.ts`             | Positions for every element from a layout                                            |
| `src/edit.ts`                | The `tam-diagrams/edit` entry point                                                  |
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
| `src/swimlane-points.ts`     | The points swimlane wires end or turn at, kept free of other wires' routes           |
| `src/swimlane-tiers.ts`      | What each search of the swimlane router may step on, strictest first                 |
| `src/swimlane-stub-clear.ts` | What blocks the router's grid, and its last resort at a wire's own stub ends         |
| `src/uml-state.ts`           | State machine diagrams: the parser                                                   |
| `src/uml-state-layout.ts`    | State machine layout: composite states, concurrent regions, notes                    |
| `src/uml-sequence.ts`        | Sequence diagrams: the parser                                                        |
| `src/uml-sequence-layout.ts` | Sequence layout: messages, activation bars, frames and notes                         |
| `src/uml-sequence-lanes.ts`  | Sequence lanes: participant headers and the column solver                            |
| `src/lane-frames.ts`         | Frames across lanes (fragments, regions), guards, notes, labels beside connections   |
| `src/scene.ts`               | The scene model all layouts produce and its box and point geometry                   |
| `src/outline.ts`             | Shape outlines: polygons, inside tests, where wires enter shapes                     |
| `src/text.ts`                | Type scale, text measuring and wrapping, text, titles, notes and scene bounds        |
| `src/arial-measure.ts`       | `arialMeasure`: text widths from Arial/Helvetica metrics, for Node without a canvas  |
| `src/font-widths.ts`         | Advance width tables (Liberation Sans, metric-compatible with Arial) for the measure |
| `src/markers.ts`             | Wire-end markers: size, outline and SVG                                              |
| `src/draw.ts`                | The SVG drawer and color tones                                                       |
| `src/elk.ts`                 | ELK layout of nested graphs and the worker pool                                      |
| `src/wires.ts`               | Wires from ELK's routes: ends, spreading and straightening                           |
| `src/wire-touch.ts`          | Two wires touching at a bend, where they would read as joined                        |
| `src/labels.ts`              | Label placement beside wires and shapes                                              |
| `src/route.ts`               | Geometry passes after ELK: shared state, segment and clearance helpers               |
| `src/route-straighten.ts`    | Passes that straighten wires and slide markers                                       |
| `src/route-center.ts`        | Passes that center elements, fans, pairs and ends                                    |
| `src/route-spread.ts`        | Passes that spread jogs and balance elements                                         |
| `src/node-labels.ts`         | A node's own labels (notes) and how they move with it                                |
| `src/audit.ts`               | Layout checks: overlaps, wires through shapes, ...                                   |
| `src/marker-clear.ts`        | The audit's marker-on-text and wire-on-marker checks, for a wire's own markers       |
| `src/best.ts`                | Scene metrics, the best-layout portfolio and the layout cache                        |
| `cli/bin.ts`                 | The executable's entry: runs `main` and sets the exit code                           |
| `cli/main.ts`                | The `render` and `check` commands, their exit codes, and the I/O port they use       |
| `cli/args.ts`                | Command line parsing and the usage text                                              |
| `cli/diagram.ts`             | Source to SVG with `arialMeasure`: TAM or Mermaid by content; the CLI's colors       |
| `cli/report.ts`              | Error messages as `<file>:<line>: <message>`                                         |
| `cli/node-io.ts`             | The I/O port on `node:fs` and the process streams                                    |
| `editor/document.ts`         | The editor's document: the source, its picture, previews and history                 |
| `editor/editor.ts`           | Selection, tools, gestures on the canvas and the commands of panels and keyboard     |
| `editor/hit.ts`              | What of a picture lies at a point, in a frame, or under a dragged element            |
| `editor/guides.ts`           | Alignment help: snapping to edges, middles and gaps; align, spread, same size        |
| `editor/view.ts`             | The canvas: viewport, grid, the picture as an image, and the overlay                 |
| `editor/ui.ts`               | The window: bar, tool rail, the two panels and what lies over the canvas             |
| `editor/menus.ts`            | The commands as menus: File, Edit, View, Arrange, Help and the right click           |
| `editor/menu.ts`             | Popup menus with submenus, ticks, keys and arrow-key movement                        |
| `editor/palette.ts`          | The Shapes tab: shapes to drag onto the canvas, or snippets for a text diagram       |
| `editor/outline.ts`          | The Outline tab: the elements as a tree that selects, names and nests                |
| `editor/inspector.ts`        | The Properties section: what is selected, in groups that keep their order            |
| `editor/statusbar.ts`        | The status bar: hint, problems, selection, pointer, layout mode, snap, zoom          |
| `editor/dialogs.ts`          | The chooser of diagram types, the question before a replace, the help sheets         |
| `editor/minimap.ts`          | The minimap: the whole diagram small, with the part on show framed                   |
| `editor/tooltip.ts`          | Tooltips with the keys of a control, and why a control is off                        |
| `editor/dom.ts`              | Elements, icons and icon buttons the panels are built from                           |
| `editor/types.ts`            | The diagram types: mode, shapes or snippets, starter and examples of each            |
| `editor/source.ts`           | The source pane: a code editor with the notation's colors and completions            |
| `editor/icons.ts`            | The editor's icons as SVG                                                            |
| `editor/main.ts`             | The page: theme, files, export, autosave                                             |
| `rolldown.config.mjs`        | The build: bundles `cli/bin.ts` into `dist/cli.js`, the package's `bin`              |
| `test/`                      | Tests; `tam.fuzz.test.ts` is a stress run gated by `HARNESS=1`                       |

## Checks

`npm install && npm test` runs the tests: every sample must render with no audit defects, and the
Mermaid samples must also parse with Mermaid. `npm run build` bundles the command line into
`dist/cli.js` (`npm install` runs it too); the command line's smoke test builds the bundle itself,
into a temporary directory, and runs it as a process. To stress-test with generated diagrams:
`HARNESS=1 COUNT=200 OUT=/tmp/fuzz.json npx vitest run test/tam.fuzz.test.ts`.

## License

MIT
