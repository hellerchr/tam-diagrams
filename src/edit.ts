/**
 * Editing TAM sources: placements (`@x,y`, and `@+dx,dy` for the label of a connection), the
 * layout that follows them, and changes to a source as text. An editor is built from these and
 * `drawScene`; editor/ is one. For the Mermaid types: the places of their parts (`%% @id x,y`),
 * of their labels (`%% @label:edge dx,dy`), the widths of lanes (`%% @lane:id width`) and the
 * layout that follows them.
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
  idFor,
  isGeneratedId,
  moveInto,
  type NewElement,
  paste,
  place,
  placeLabel,
  remove,
  renameId,
  setConnection,
  setElement,
  setHeader,
  unplace,
  wrap,
} from "./tam-edit.ts";
export { declaredElements, elementBoxes, layoutWithin, overlapping, pin } from "./tam-pin.ts";
export { layoutDiagram, layoutPlaced } from "./tam-layout.ts";
export {
  followPlaces,
  hasMarks,
  hasPlaces,
  type Places,
  prunePlaces,
  readLabels,
  readLanes,
  readPlaces,
  removePlaces,
  renamePlace,
  setLabel,
  setLane,
  setPlaces,
  unmarked,
} from "./uml-places.ts";
export { labelGroups, labelKey, labelOffset, lineMiddle, placeLabels } from "./label-places.ts";
export { placeable, placeScene, placesOf } from "./uml-placed.ts";
export { laneFrame, type LaneFrame } from "./uml-lanes.ts";
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
