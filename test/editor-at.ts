// An editor on a page without layout: a document, the editor, and a canvas that takes pointer
// events at the coordinates of the diagram. The tests of gestures on the canvas drive it.
import { arialMeasure } from "../src/arial-measure.ts";
import { Doc } from "../editor/document.ts";
import { Editor } from "../editor/editor.ts";
import type { View } from "../editor/view.ts";
import { colors } from "./fixtures.ts";

/** An editor showing a source, with the notices it gave and the means to press and drag on its canvas. */
export async function editorAt(source: string) {
  const doc = new Doc(arialMeasure),
    canvas = document.createElement("canvas");
  // The page has no pointer capture: the canvas takes every event anyway.
  Object.assign(canvas, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });
  // The view shows the diagram at its natural size, its origin at the canvas's corner.
  const view = {
    canvas,
    zoom: 1,
    origin: { x: 0, y: 0 },
    overlay: () => {},
    onView: () => {},
    toScene: (point: { x: number; y: number }) => ({ ...point }),
    toScreen: (point: { x: number; y: number }) => ({ ...point }),
    boxOnScreen: (box: { x: number; y: number; width: number; height: number }) => ({ ...box }),
    pointOf: (event: { clientX: number; clientY: number }) => ({
      x: event.clientX,
      y: event.clientY,
    }),
    show: async () => {},
    invalidate() {},
    reveal() {},
    fit() {},
    zoomTo() {},
    zoomBy() {},
    panBy() {},
  } as unknown as View;
  const editor = new Editor(doc, view, colors),
    notes: string[] = [];
  editor.notify = (message) => notes.push(message);
  doc.onChange = () => editor.refresh();
  await doc.open(source);
  /** Resolves once the picture of the committed source is on show. */
  const settled = async () => {
    for (let tries = 0; tries < 400 && !doc.problem && doc.picture?.source !== doc.source; tries++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const fire = (type: string, x: number, y: number, more: MouseEventInit = {}) =>
    canvas.dispatchEvent(
      Object.assign(
        new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...more }),
        { pointerId: 1 },
      ),
    );
  /** Presses at one point, moves to another in steps, and lets go there. */
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    fire("pointerdown", from.x, from.y);
    for (let step = 1; step <= 4; step++)
      fire(
        "pointermove",
        from.x + ((to.x - from.x) * step) / 4,
        from.y + ((to.y - from.y) * step) / 4,
      );
    // A preview of a diagram that lays itself out comes a moment later.
    await new Promise((resolve) => setTimeout(resolve, 30));
    fire("pointerup", to.x, to.y);
    await settled();
  };
  return { doc, editor, notes, canvas, fire, drag, settled };
}
