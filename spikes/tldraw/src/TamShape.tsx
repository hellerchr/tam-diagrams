/**
 * The box tldraw holds for a TAM element. It draws nothing of its own: the picture comes from the
 * library, under the boxes, so the canvas shows exactly what the library renders. The box is what
 * is selected, moved, resized, and what holds the boxes of the element's parts.
 */

import { useState } from "react";
import {
  BaseBoxShapeTool,
  BaseFrameLikeShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  type TLShape,
  useEditor,
  useIsEditing,
} from "tldraw";
import type { ElementKind } from "../../../src/tam-edit.ts";
import { model } from "./model.ts";

export type TamShape = TLBaseShape<
  "tam",
  { w: number; h: number; element: string; kind: string; label: string; container: boolean }
>;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    tam: TamShape["props"];
  }
}

/** The name of an element, typed on the canvas. */
function Label({ shape }: { shape: TamShape }) {
  const editor = useEditor(),
    [text, setText] = useState(shape.props.label.replace(/<br\s*\/?>/gi, " "));
  const done = (take: boolean) => {
    if (take && text !== shape.props.label) model.rename(shape.props.element, text);
    editor.setEditingShape(null);
  };
  return (
    <div className="tam-label" style={{ pointerEvents: "all" }}>
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => done(true)}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") done(true);
          if (event.key === "Escape") done(false);
        }}
      />
    </div>
  );
}

function Body({ shape }: { shape: TamShape }) {
  const editing = useIsEditing(shape.id);
  return (
    <HTMLContainer style={{ pointerEvents: "all" }}>
      {/* A box drawn with a tool shows until it becomes an element; the others are drawn by the picture. */}
      {!shape.props.element && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1.5px dashed #2a78d6",
            borderRadius: shape.props.kind === "storage" ? shape.props.h / 2 : 0,
            background: "rgba(42,120,214,.08)",
          }}
        />
      )}
      {editing && shape.props.element && <Label shape={shape} />}
    </HTMLContainer>
  );
}

export class TamShapeUtil extends BaseFrameLikeShapeUtil<TamShape> {
  static override type = "tam" as const;
  static override props = {
    w: T.number,
    h: T.number,
    element: T.string,
    kind: T.string,
    label: T.string,
    container: T.boolean,
  };

  override getDefaultProps(): TamShape["props"] {
    return { w: 96, h: 40, element: "", kind: "agent", label: "", container: false };
  }

  // Unlike a frame, an element is selected and dragged by its body, a container too.
  override isFrameLike() {
    return false;
  }

  override canEdit() {
    return true;
  }

  override hideRotateHandle() {
    return true;
  }

  // Only an element that holds others takes boxes dropped on it; the notation has the last word when the source is edited.
  override canReceiveNewChildrenOfType(shape: TamShape, type: TLShape["type"]) {
    return type === "tam" && shape.props.container;
  }

  // The picture is not cut at a container's edge: it fits its parts once the source is laid out.
  override getClipPath() {
    return undefined;
  }

  override component(shape: TamShape) {
    return <Body shape={shape} />;
  }

  override getIndicatorPath(shape: TamShape) {
    const path = new Path2D(),
      { w, h, kind, container } = shape.props;
    if (kind === "storage") path.roundRect(0, 0, w, h, container ? 18 : h / 2);
    else path.rect(0, 0, w, h);
    return path;
  }
}

/** A tool that draws a box and makes it an element of one kind. */
const toolFor = (kind: ElementKind) =>
  class extends BaseBoxShapeTool {
    static override id = `tam-${kind}`;
    static override initial = "idle";
    override shapeType = "tam" as const;

    // A click makes the box without telling the tool: the model takes it up when the store settles.
    override onEnter() {
      model.drawing = kind;
    }

    override onCreate(shape: TLShape | null) {
      if (shape) model.adopt(shape, kind);
      this.editor.setCurrentTool("select");
    }
  };

export const KINDS: ElementKind[] = ["agent", "human", "storage", "group", "component"];

export const TOOLS = KINDS.map(toolFor);
