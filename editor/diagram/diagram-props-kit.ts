// The diagram's Properties' modules as one object (DiagramProperties.svelte loads them together, after the panel's
// first frame, and hands its panes the object as `P`): the diagram's settings, a block diagram's elements and
// connections, laying out a selection, and a UML diagram's parts and joins.
import type * as Header from "./diagram-props.ts";
import type * as Layout from "./diagram-props-layout.ts";
import type * as Tam from "./diagram-props-tam.ts";
import type * as Uml from "./diagram-props-uml.ts";

/** Every export of the panel's modules. */
export type Kit = typeof Header & typeof Layout & typeof Tam & typeof Uml;
