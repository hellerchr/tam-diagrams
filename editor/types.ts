// The type of diagram a source draws, as the source pane, its syntax and completions read it.
import { detectUml, type UmlKind } from "../src/index.ts";

export type DiagramType = "tam" | UmlKind;

/**
 * The type of a source: a Mermaid header names a UML type, anything else is a block diagram. An
 * activity diagram says `flowchart` or `swimlane` by its header, whether it has lanes.
 */
export const typeOf = (source: string): DiagramType => detectUml(source) ?? "tam";
