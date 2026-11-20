// What the diagram editor's Properties (DiagramProperties.svelte) show and offer, on src/tam, as tam-diagrams' old
// inspector had them: the settings of the whole diagram (title, and the direction, level and numbered messages its type
// has), with the block diagram's elements and connections (diagram-props-tam.ts) and a UML diagram's parts and joins
// (diagram-props-uml.ts). An offer is what the notation takes: each is tried on the source and kept when the result
// parses. Every change is a whole new source; one the notation refuses throws its reason. Loaded with the panel.
import type { Direction } from "../../src/elk.ts";
import { parseTam } from "../../src/tam.ts";
import { detectUml, type Level, type UmlKind } from "../../src/uml.ts";
import { setUmlHeader, turnPlaces, umlHeader, umlSettings } from "../../src/uml-header-edit.ts";
import { hasPlaces, readPlaces, setPlaces } from "../../src/uml-places.ts";
import * as edit from "../../src/tam-edit.ts";
import {
  roundCorners,
  titleHidden,
  withRoundCorners,
  withTitleShown,
} from "../../src/title-mark.ts";
import { reason } from "./diagram-props-tam.ts";

export type { Direction };

/** What a source says of its whole diagram, and which of the settings its type has besides the title. */
export type Header = {
  /** "tam" for a block diagram, else the UML type. */
  kind: UmlKind | "tam";
  title: string;
  /** The title is drawn above the picture (`%% @title hidden` says it is not). */
  titleShown: boolean;
  /** The connections bend round at their corners (`%% @corners round`); square without. */
  rounded: boolean;
  direction?: Direction;
  level?: Level;
  numbered?: boolean;
  /** Whether the type has each setting: a block diagram has no level (the editor draws it conceptual). */
  has: { direction: boolean; level: boolean; numbering: boolean };
};
/** A change of the settings of a whole diagram: an empty title or level removes it. */
export type HeaderChange = {
  title?: string;
  titleShown?: boolean;
  rounded?: boolean;
  direction?: Direction;
  level?: Level | "";
  numbered?: boolean;
};
/** The sizes of the shapes on show, by id: a UML diagram placed by hand turns its places with its direction. */
export type Sizes = ReadonlyMap<string, { width: number; height: number }>;

/** What each level means in a diagram of a type, as the Level buttons' tooltips say it. */
const FLOW = {
  any: "No level said",
  conceptual: "TAM's conceptual level: what is done, by whom",
  design: "TAM's design level: how the system does it",
};
export const LEVELS: Partial<Record<UmlKind, { any: string; conceptual: string; design: string }>> =
  {
    class: {
      any: "No level: everything a class diagram has",
      conceptual:
        "Classes and their relations, without visibility, interfaces, templates, realization or dependencies",
      design: "Everything a class diagram has, as no level",
    },
    state: {
      any: "No level said",
      conceptual: "States and transitions, without fork or join bars",
      design: "State machines belong to the conceptual level in TAM",
    },
    usecase: {
      any: "No level said",
      conceptual: "Actors, use cases and their relations",
      design: "Use case diagrams belong to the conceptual level in TAM",
    },
    sequence: {
      any: "No level said",
      conceptual: "Messages between participants, without creating or destroying objects",
      design: "Objects created and destroyed too",
    },
    flowchart: FLOW,
    swimlane: FLOW,
  };

/** What `source` says of its whole diagram (`lang`: tam or mermaid); undefined when it does not read. */
export function headerOf(source: string, lang: string): Header | undefined {
  try {
    if (lang === "tam") {
      const { title, direction } = parseTam(source);
      return {
        kind: "tam",
        title: title ?? "",
        titleShown: !titleHidden(source),
        rounded: roundCorners(source),
        direction,
        has: { direction: true, level: false, numbering: false },
      };
    }
    const kind = detectUml(source);
    if (!kind) return undefined;
    const said = umlHeader(source);
    const settings = umlSettings(kind);
    return {
      kind,
      title: said.title ?? "",
      titleShown: !titleHidden(source),
      rounded: roundCorners(source),
      direction: said.direction ?? settings.direction,
      level: said.level,
      numbered: said.numbered,
      has: {
        direction: !!settings.direction,
        level: settings.level,
        numbering: settings.numbering,
      },
    };
  } catch {
    return undefined;
  }
}

/** `source` with its header changed; a UML diagram placed by hand turns its places with the direction. Throws when the
 *  notation refuses the change. */
export function withHeader(
  source: string,
  lang: string,
  change: HeaderChange,
  sizes: Sizes = new Map(),
): string {
  const titled =
    change.titleShown === undefined ? source : withTitleShown(source, change.titleShown);
  const marked = change.rounded === undefined ? titled : withRoundCorners(titled, change.rounded);
  if (lang === "tam") {
    const next = edit.setHeader(marked, change);
    parseTam(next);
    return next;
  }
  const next = setUmlHeader(marked, change);
  const from = umlHeader(source).direction;
  const to = change.direction;
  if (!to || !from || from === to || !hasPlaces(source)) return next;
  return setPlaces(next, turnPlaces(readPlaces(source), sizes, from, to));
}

/** Why the header may not change so; undefined when it may. */
export function headerRefusal(
  source: string,
  lang: string,
  change: HeaderChange,
): string | undefined {
  try {
    withHeader(source, lang, change);
    return undefined;
  } catch (error) {
    return reason(error);
  }
}
