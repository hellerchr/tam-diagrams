/**
 * Building blocks for drawing further diagram types in the style of this package: ELK layout of
 * nested graphs, wire, label and marker placement, the scene model and its helpers, layout checks
 * and the best-of-several-strategies search, and the shared parsing of Mermaid sources. Also the
 * TAM layout steps renderTam runs.
 */
export { addWire, attachEnds, straightenScene } from "./wires";
export {
  type Direction,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphPort,
  improveRoutes,
  layoutGraph,
  type LayoutOptions,
  orthogonal,
  type Placement,
} from "./elk";
export { dodgeTitles, hugLabels, smallLines, smallSize, wrapSmall } from "./labels";
export { runsAlong } from "./route";
export { bestScene, cachedLayout, STRATEGIES } from "./best";
export { crossesBox, crossesShape } from "./audit";
export { addText, addTitleLines, drawNote, finishBounds, FONT, LINE, SMALL, wrap } from "./text";
export {
  type Box,
  centerOf,
  distance,
  emptyScene,
  grow,
  overlaps,
  type Point,
  type SceneShape,
  segmentsCross,
  unit,
} from "./scene";
export { entryPoint } from "./outline";
export { MARKER_LENGTH, markerBounds, type MarkerKind, markerPoints } from "./markers";
export { mix, tones } from "./draw";
export {
  accessibilityLines,
  labelText,
  type Level,
  prepare,
  reversePostorder,
  STYLING,
  unsupported,
} from "./uml";
export { bestLayout, layoutTam } from "./tam-layout";
