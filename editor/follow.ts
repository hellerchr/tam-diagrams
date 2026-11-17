/** The view following the edits: it keeps on what an edit changed once its picture was laid out. */

import { around, type Box, type Scene } from "../src/scene.ts";
import type { Doc } from "./document.ts";
import type { Editor } from "./editor.ts";

/** How much of the area two boxes cover together they share: 1 for the same box, 0 for boxes apart. */
function shared(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    both = Math.max(0, width) * Math.max(0, height),
    all = a.width * a.height + b.width * b.height - both;
  return all > 0 ? both / all : 1;
}

/** The box around some elements of a scene; undefined when it draws none of them. */
function boxOf(scene: Scene, ids: string[]): Box | undefined {
  const boxes = scene.shapes.filter((shape) => ids.includes(shape.id)).map((shape) => shape.box);
  return boxes.length ? around(boxes) : undefined;
}

/** Whether a scene draws something, over an area that has a width. */
const drawn = (scene: Scene) => scene.shapes.length > 0 && !!scene.bounds.width;

/** Whether a diagram lies somewhere else altogether than it did. */
const elsewhere = (was: Scene, now: Scene) =>
  drawn(was) && drawn(now) && shared(was.bounds, now.bounds) < 0.2;

const sameBox = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Keeps the view on what an edit changed. A diagram that lies somewhere else altogether shows
 * whole again. Else the view stays, but for the least move that keeps in view a selected element
 * that was in view or is new; and a diagram that showed whole and no longer fits is fitted again
 * when no element moved.
 */
function follow(editor: Editor, was: Scene, now: Scene) {
  if (elsewhere(was, now)) return editor.fit();
  const ids = editor.selectedElements,
    box = boxOf(now, ids),
    old = boxOf(was, ids);
  if (box && !(old && sameBox(old, box))) reveal(editor, box, old);
  else if (outgrown(editor, now)) editor.fit();
}

/** Brings an element that moved into view, when it was in view before or is new. */
function reveal(editor: Editor, box: Box, old: Box | undefined) {
  if (!old || editor.view.shows(old)) editor.view.reveal(box);
}

/** Whether a diagram that showed whole no longer fits. */
const outgrown = (editor: Editor, now: Scene) =>
  editor.view.isFitted && now.shapes.length > 0 && !editor.view.shows(now.bounds);

/** The picture of the document's source, once it was laid out; undefined while there is none. */
function shown(doc: Doc): Scene | undefined {
  const { picture } = doc;
  return picture && !doc.problem && picture.source === doc.source ? picture.scene : undefined;
}

/** The picture the view follows: that of the source on show, once it was laid out. */
export class Follower {
  private readonly editor: Editor;
  private settled: { source: string; scene: Scene } | undefined;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Forgets the picture: a whole other diagram is on show, with nothing to follow from. */
  forget() {
    this.settled = undefined;
  }

  /**
   * Takes the picture of the document once it shows its source, and keeps the view on what
   * changed since the one before. True when a new picture was taken.
   */
  settle(doc: Doc): boolean {
    const scene = shown(doc);
    if (!scene || this.settled?.source === doc.source) return false;
    const before = this.settled?.scene;
    this.settled = { source: doc.source, scene };
    // What the edit selects is selected once the edit is through.
    if (before)
      queueMicrotask(() => {
        if (doc.picture?.scene === scene) follow(this.editor, before, scene);
      });
    return true;
  }
}
