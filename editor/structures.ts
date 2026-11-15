/**
 * The diagram types whose structure is edited on the canvas while their layout stays automatic:
 * each has a `Structure` that reads its parts from the source and makes the edits.
 */

import type { Structure } from "../src/structure.ts";
import { flowStructure, swimlaneStructure } from "../src/uml-activity-edit.ts";
import {
  classStructure,
  duplicateClass,
  moveClassInto,
  renameClassId,
  reverseClassRelation,
  ungroupClassPackage,
} from "../src/uml-class-edit.ts";
import {
  connectSequence,
  renameParticipantId,
  sequenceStructure,
  unwrapFragment,
} from "../src/uml-sequence-edit.ts";
import {
  connectState,
  duplicateState,
  moveStateInto,
  renameStateId,
  reverseTransition,
  stateStructure,
  ungroupComposite,
} from "../src/uml-state-edit.ts";
import {
  duplicateUsecasePart,
  moveUsecaseInto,
  renameUsecaseId,
  reverseUsecaseRelation,
  ungroupUsecaseBoundary,
  usecaseStructure,
} from "../src/uml-usecase-edit.ts";
import type { IconName } from "./icons.ts";

const STRUCTURES: Record<string, Structure | undefined> = {
  flowchart: flowStructure,
  swimlane: swimlaneStructure,
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
  sequence: {
    ...sequenceStructure,
    join: (source, from, to, kind, after) => connectSequence(source, from, to, kind, { after }),
    ungroup: unwrapFragment,
    reid: renameParticipantId,
  },
};

/** The structure of a diagram type; undefined for a type edited another way. */
export const structureOf = (type: string): Structure | undefined => STRUCTURES[type];

/** The drawings of the pieces, by words their kinds contain: the most telling word first. */
const ICONS: [RegExp, IconName][] = [
  [/interface/, "uml-interface"],
  [/abstract/, "uml-abstract"],
  [/enum/, "uml-enum"],
  [/class/, "class"],
  [/package|namespace/, "package"],
  [/actor|person/, "uml-actor"],
  [/usecase|use-case|case/, "uml-usecase"],
  [/system|boundary/, "uml-system"],
  [/decision|choice/, "uml-decision"],
  [/start|initial/, "uml-start"],
  [/end|final/, "uml-end"],
  [/composite/, "uml-composite"],
  [/note/, "uml-note"],
  [/participant|lifeline/, "uml-participant"],
  [/lane/, "uml-lane"],
  [/group|box|frame/, "group"],
  [/fork|join|bar/, "uml-lane"],
  [/step|state|node/, "uml-step"],
];

/** The drawing of a piece. */
export const pieceIcon = (kind: string): IconName =>
  ICONS.find(([words]) => words.test(kind.toLowerCase()))?.[1] ?? "uml-step";

/** The drawings of the joins, by words their kinds contain. */
const LINK_ICONS: [RegExp, IconName][] = [
  [/realiz/, "uml-realize"],
  [/inherit|general/, "uml-inherit"],
  [/aggreg/, "uml-aggregate"],
  [/compos/, "uml-compose"],
  [/dashed|dotted.?(line|both)?$/, "uml-dashed-link"],
  [/^(link|line|undirected|lost|both)$/, "uml-link"],
  [/depend|include|extend|dotted|reply|return/, "uml-dashed"],
  [/message|call|sync/, "uml-message"],
];

/** The drawing of a kind of join. */
export const linkIcon = (kind: string): IconName =>
  LINK_ICONS.find(([words]) => words.test(kind.toLowerCase()))?.[1] ?? "uml-arrow";
