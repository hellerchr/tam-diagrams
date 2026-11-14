import { UmlError } from "./uml";
import type { SequenceDiagram } from "./uml-sequence";

/**
 * Throws the UmlError the layout raises when a bar is closed that is not open, so parseUml reports it
 * too. Mirrors the layout's bar stack: `activate` and `+` open a bar on the target, `deactivate` and
 * `-` close one on the sender; keep the two in step.
 */
export function checkActivations(events: SequenceDiagram["events"]): void {
  const open = new Map<string, number>();
  const push = (who: string) => open.set(who, (open.get(who) ?? 0) + 1);
  const pop = (who: string, line: number) => {
    const depth = open.get(who) ?? 0;
    if (!depth) throw new UmlError(line, `\`${who}\` is not active.`);
    open.set(who, depth - 1);
  };
  for (const event of events) {
    if (event.type === "activate") push(event.who);
    else if (event.type === "deactivate") pop(event.who, event.line);
    else if (event.type === "message") {
      if (event.activate) push(event.to);
      if (event.deactivate) pop(event.from, event.line);
    }
  }
}
