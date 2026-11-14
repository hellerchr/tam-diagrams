import { HEADER_END, scan, unsupported } from "./uml.ts";

/**
 * Stems of the Mermaid diagram types this package does not draw: the diagram detectors of mermaid
 * 12.3.0 (dist/*.mjs) minus the ones `HEADERS` in uml.ts routes. Mermaid matches a stem as a
 * prefix, so suffixed spellings such as `architecture-beta` belong to it.
 */
const STEMS = [
  ...["agentflow-beta", "architecture", "block", "C4Component", "C4Container", "C4Context"],
  ...["C4Deployment", "C4Dynamic", "cynefin-beta", "erDiagram", "eventmodeling", "gantt"],
  ...["gitGraph", "info", "ishikawa", "journey", "kanban", "mindmap", "packet", "pie"],
  ...["quadrantChart", "radar-beta", "railroad-abnf-beta", "railroad-beta", "railroad-ebnf-beta"],
  ...["railroad-peg-beta", "requirement", "requirementDiagram", "sankey", "timeline", "treemap"],
  ...["treeView-beta", "venn-beta", "wardley-beta", "xychart"],
];
const HEADER = new RegExp(String.raw`^(?:${STEMS.join("|")})(?:-\w+)?${HEADER_END}`);

/**
 * Throws the `unsupported` UmlError, at the keyword's line, when a source starts with a Mermaid
 * diagram type this package does not draw. Runs before any size limit or TAM rule, so callers can
 * hand the source to Mermaid.js whatever its size.
 */
export function rejectUnsupported(source: string): void {
  // The same first statement detectUml reads: past frontmatter, comments and `%%{ }%%` directives.
  const first = scan(source.slice(0, 4000)).lines[0];
  const word = first?.text.match(HEADER)?.[0];
  if (word) unsupported(first.line, word);
}
