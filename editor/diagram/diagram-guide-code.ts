// The code of the guide sheet (GuidePanel.svelte) in the source pane's colors, as the old editor's reference-dialog.ts
// colored it: the tokens of some lines of a source of a type, read by the diagram syntax's tokenizer, as text with the
// `tok-*` class of each (styles/base.css). A row is colored as it reads among the lines it stands in. Loaded with the
// guides.
import { type Guide, type GuideRow, type GuideSection, rowSource } from "../../src/reference.ts";
import { scanSource } from "../syntax.ts";
import { type DiagramType, typeOf } from "../types.ts";

/** A piece of colored code: its text and its class (none: plain). */
export type Bit = { text: string; tok?: string };

/** The `count` lines of `source` from line `first` (0-based), in the colors of a source of `type`. */
export function colored(type: DiagramType, source: string, first: number, count: number): Bit[] {
  const texts = source.split("\n").slice(first, first + count);
  const tokens = scanSource(type, source).lines.slice(first, first + count);
  const out: Bit[] = [];
  texts.forEach((text, index) => {
    let at = 0;
    for (const token of tokens[index] ?? []) {
      if (token.from > at) out.push({ text: text.slice(at, token.from) });
      out.push({ text: token.text, tok: `tok-${token.tag.split(".")[0]}` });
      at = token.to;
    }
    out.push({ text: text.slice(at) + (index < texts.length - 1 ? "\n" : "") });
  });
  return out;
}

const sameType = (a: DiagramType, b: string) => a === b || (a === "swimlane" && b === "flowchart");

/** The code of a row, colored as it reads among the lines it stands in; a sign on its own is plain. */
export function rowCode(guide: Guide, section: GuideSection, item: GuideRow): Bit[] {
  if (item.fragment) return [{ text: item.write }];
  const before = rowSource(guide, section, { ...item, write: "", after: undefined });
  const source = rowSource(guide, section, item);
  // A row read under another first line of the type is colored as that one: the lanes of an activity.
  const kind: DiagramType = guide.type === "tam" ? "tam" : typeOf(source);
  const type = sameType(kind, guide.type) ? kind : guide.type;
  return colored(
    type,
    source,
    before ? before.split("\n").length : 0,
    item.write.split("\n").length,
  );
}

/** A guide's whole example, colored. */
export const exampleCode = (guide: Guide, source: string): Bit[] =>
  colored(guide.type, source, 0, source.split("\n").length);
