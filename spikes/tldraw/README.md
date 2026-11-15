# Spike: tldraw as the editor's canvas

`npm install && npm run dev` here, then http://localhost:5200/.

The question: can tldraw replace the hand-written canvas of `editor/` and keep what makes the
editor ours, the TAM source as the document and the library's own picture?

How it is put together (about 450 lines, `src/`):

- tldraw holds one transparent box per element (`TamShapeUtil`), nested as the elements are. The
  box is what is selected, moved, resized, and dropped into a container.
- The picture is drawn by tam-diagrams from the source and shown as one image on the page, under the
  boxes (`OnTheCanvas`). The canvas therefore shows exactly what `render` exports, wires included.
- `Model` syncs both ways. A change of a box becomes an edit of the source (`place`, `moveInto`,
  `remove`, `addElement`, `connect` from `tam-diagrams/edit`); the source is laid out; the boxes
  follow the layout. While the user drags, boxes are only read.
- An arrow drawn with tldraw's arrow tool between two elements becomes a connection and is removed:
  the library routes and draws the wire.
- Undo and redo step through sources, since the boxes are derived.

What works: move, resize, nest by dragging in and out, create with tools (click or drag), rename by
double click, connect, delete, undo and redo, the source pane both ways, and everything tldraw
brings for free: selection and its handles, snapping, alignment and distribution menus, zoom and
minimap, touch, keyboard shortcuts, context menu.

What is missing compared with `editor/`: wires cannot be selected or changed on the canvas (kind,
label, ends, delete), no inspector, no element tree, no palette limited to what the notation allows,
no copy and paste of elements, no placed copies (`...`).

To weigh:

- Licence: tldraw may be used in development; production needs a licence key from tldraw (see its
  LICENSE.md). This repository is MIT, so a tldraw editor could not ship as part of it as it is.
- Weight: React and tldraw, about 1.5 MB of JavaScript against none.
- Two models: tldraw's store and the source must be kept in step; every feature that is not
  "boxes" (wires, labels, protocol boundaries) has to be built beside tldraw rather than with it.
