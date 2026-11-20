// The UML types the diagram editor edits on the canvas, each by the `Structure` of src/tam that reads its parts and
// joins and makes its edits (the old editor's structures.ts), and their palettes: the pieces to add and the kinds of
// join, as the palette's items. Loaded with diagram-uml.ts.
import type { Structure } from "../../src/structure.ts";
import { activityStructure } from "../../src/uml-activity-edit.ts";
import {
  classStructure,
  duplicateClass,
  moveClassInto,
  renameClassId,
  reverseClassRelation,
  ungroupClassPackage,
} from "../../src/uml-class-edit.ts";
import { erStructure } from "../../src/uml-er-edit.ts";
import {
  connectSequence,
  renameParticipantId,
  sequenceStructure,
  unwrapFragment,
} from "../../src/uml-sequence-edit.ts";
import {
  connectState,
  duplicateState,
  moveStateInto,
  renameStateId,
  reverseTransition,
  stateStructure,
  ungroupComposite,
} from "../../src/uml-state-edit.ts";
import {
  duplicateUsecasePart,
  moveUsecaseInto,
  renameUsecaseId,
  reverseUsecaseRelation,
  ungroupUsecaseBoundary,
  usecaseStructure,
} from "../../src/uml-usecase-edit.ts";
import { linkIcon, pieceIcon } from "./diagram-uml-icons.ts";
import type { Palette } from "./palettes.ts";

const STRUCTURES: Record<string, Structure | undefined> = {
  // Activity diagrams with lanes and without are one type: the header says which they are.
  flowchart: activityStructure,
  swimlane: activityStructure,
  class: {
    ...classStructure,
    reverse: reverseClassRelation,
    copy: duplicateClass,
    moveInto: moveClassInto,
    ungroup: ungroupClassPackage,
    reid: renameClassId,
  },
  usecase: {
    ...usecaseStructure,
    reverse: reverseUsecaseRelation,
    copy: duplicateUsecasePart,
    moveInto: moveUsecaseInto,
    ungroup: ungroupUsecaseBoundary,
    reid: renameUsecaseId,
  },
  state: {
    ...stateStructure,
    join: (source, from, to) => connectState(source, from, to),
    reverse: reverseTransition,
    copy: duplicateState,
    moveInto: moveStateInto,
    ungroup: ungroupComposite,
    reid: renameStateId,
  },
  er: erStructure,
  sequence: {
    ...sequenceStructure,
    join: (...[source, from, to, kind, after]: Parameters<NonNullable<Structure["join"]>>) =>
      connectSequence(source, from, to, kind, { after }),
    ungroup: unwrapFragment,
    reid: renameParticipantId,
  },
};

/** The structure of a UML type; undefined for a type edited only in the source. */
export const structureOf = (kind: string): Structure | undefined => STRUCTURES[kind];

const palettes = new Map<string, Palette>();

/** The palette of a UML type: its pieces and its kinds of join; undefined for a type without a structure. */
export function palette(kind: string): Palette | undefined {
  const structure = STRUCTURES[kind];
  if (!structure) return undefined;
  let found = palettes.get(kind);
  if (!found)
    palettes.set(
      kind,
      (found = {
        shapes: structure.pieces.map((p) => ({
          kind: p.kind,
          name: p.name,
          hint: p.about,
          icon: pieceIcon(p.kind),
        })),
        links: structure.links.map((l) => ({ kind: l.kind, name: l.name, icon: linkIcon(l.kind) })),
      }),
    );
  return found;
}
