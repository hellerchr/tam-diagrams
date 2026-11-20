// The diagram editor's edits of a Mermaid UML diagram (DiagramView.svelte, diagram-editor.svelte.ts), by the structure
// of its type: its model (diagram-uml-model.ts), moving its parts (diagram-uml-moves.ts), editing its structure
// (diagram-uml-parts.ts) and its palette (diagram-uml-structures.ts), as one object. Loaded with the first UML diagram
// the editor shows.
import * as model from "./diagram-uml-model.ts";
import * as moves from "./diagram-uml-moves.ts";
import * as parts from "./diagram-uml-parts.ts";
import { palette } from "./diagram-uml-structures.ts";

/** Every edit of a UML diagram. */
export const uml = { ...model, ...moves, ...parts, palette };
