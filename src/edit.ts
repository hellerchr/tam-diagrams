/**
 * Editing TAM sources: placements (`@x,y`), the layout that follows them, and changes to a source
 * as text. An editor is built from these and `drawScene`; editor/ is one.
 */
export {
  addElement,
  addInterface,
  connect,
  connectionOf,
  copyOf,
  type ConnectionChange,
  defaultConnection,
  duplicate,
  type ElementChange,
  type ElementKind,
  holder,
  moveInto,
  type NewElement,
  paste,
  place,
  remove,
  setConnection,
  setElement,
  setHeader,
  unplace,
  wrap,
} from "./tam-edit.ts";
export { declaredElements, elementBoxes, pin } from "./tam-pin.ts";
export { layoutDiagram, layoutPlaced } from "./tam-layout.ts";
export {
  COLORS,
  type Connection,
  ELEMENT_KINDS,
  isPlaced,
  type Placement,
  type TamEdge,
  type TamNode,
  type Word,
} from "./tam.ts";
