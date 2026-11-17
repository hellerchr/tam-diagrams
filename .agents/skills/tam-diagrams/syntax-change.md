# Changing a notation's syntax

A change to what a source may say ripples through every place that reads or writes that syntax. It is done when each place below is updated, or you can say why it needs nothing.

1. **Parser**: `src/tam.ts` for block diagrams, `src/uml-<type>.ts` for a Mermaid type. A refused source raises the type's error with its line and a sentence that names what to write instead.
2. **Layout and picture**:
   - Block diagrams: `src/tam-graph.ts` → `tam-geometry.ts` → `tam-scene.ts` for the automatic layout, `src/tam-placed*.ts` for the layout by hand.
   - Mermaid types: `src/uml-<type>-layout.ts`, and `src/uml-placed.ts` for placed parts.
3. **Editing as text**: `src/tam-edit.ts` or `src/uml-<type>-edit.ts`. Every edit returns the source with one change made and every other line as its author wrote it.
4. **Editor**:
   - the palette and type list in `editor/types.ts`
   - completion in `editor/completion.ts` or `completion-uml.ts`
   - the tokenizer in `editor/syntax.ts`
   - the inspector, where the change has a property
5. **Guide**: `editor/reference.ts`, then regenerate `docs/guides/` (see Done in SKILL.md).
6. **draw.io**: the type's `src/drawio-<type>.ts`, both export and import (see [drawio.md](drawio.md)).
7. **README**: its syntax section.

## Positions are text too

- A block diagram places an element on its declaration: `@x,y WxH`. A connection's label offset goes behind the connection: `@+dx,dy`.
- A Mermaid source places parts with comment lines at its end, so it stays valid Mermaid: `%% @id x,y`, `%% @label:<edge> +dx,dy`, `%% @lane:<subgraph> <width>` (`src/uml-places.ts`).
- A syntax change keeps these readable and keeps them in step when ids change.

## The editor's level

The editor offers block diagrams at TAM's conceptual level only: agents, human agents, storages, groups, notes, channels and accesses. The parser still reads the design level (components, subsystems, classes, packages, interfaces), so existing sources open and draw.
