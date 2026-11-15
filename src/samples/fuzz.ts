/**
 * Seeded generators of random, valid diagram sources for stress tests: TAM block diagrams (every
 * element kind, nesting, all connection words, protocols, multiples and dots) and Mermaid class, state
 * and flowchart sources (every transition and edge kind, nesting, long and unicode names, both directions).
 */

/** Small deterministic PRNG (mulberry32). */
export function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

export const WORDS = [
  "Order",
  "Service",
  "Gateway",
  "Cache",
  "Index",
  "Billing",
  "Customer",
  "Ledger",
  "Queue",
  "Worker",
  "Search",
  "Report",
  "Session",
  "Profile",
  "Inventory",
  "Shipping",
  "Payment",
  "Audit",
  "Config",
  "Event",
  "Stream",
  "Archive",
  "Router",
  "Proxy",
  "Scheduler",
];
const LONG = [
  "Asynchronous",
  "Replication",
  "Orchestration",
  "Authorization",
  "Reconciliation",
  "Synchronization",
];
const UNICODE = ["Übersicht", "Größe", "Straße", "注文", "Résumé", "Zürich"];
const PROTOCOLS = ["HTTP", "HTTPS", "RFC", "gRPC", "SQL", "AMQP", "SOAP Messages (XML)"];
const COLORS = ["blue", "orange", "green", "yellow", "pink", "purple", "red", "gray"];

export interface FuzzOptions {
  elements?: number;
  design?: boolean;
  direction?: "TB" | "BT" | "LR" | "RL";
}

interface Element {
  id: string;
  kind: string;
  parent: Element | null;
  children: Element[];
  passive: boolean;
  multiple: boolean;
}

export function generateTam(seed: number, options: FuzzOptions = {}): string {
  const r = random(seed);
  const count = options.elements ?? r.int(4, 36);
  const design = options.design ?? r.chance(0.25);
  const direction =
    options.direction ?? r.pick(["TB", "TB", "TB", "LR", "LR", "BT", "RL"] as const);
  const label = () => {
    if (r.chance(0.06)) return "";
    const words = Array.from({ length: r.pick([1, 1, 2, 2, 2, 3, 4, 7]) }, () =>
      r.chance(0.08) ? r.pick(LONG) : r.chance(0.05) ? r.pick(UNICODE) : r.pick(WORDS),
    );
    if (words.length > 2 && r.chance(0.2)) words.splice(1, 0, "<br>");
    return words.join(" ").replace(/ <br> /g, "<br>");
  };

  // Elements: a random tree. Storages hold only storages, humans hold nothing, components hold components, classes and storages.
  const elements: Element[] = [];
  const roots: Element[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    const containers = elements.filter(
      (element) =>
        (element.kind === "agent" ||
          element.kind === "group" ||
          element.kind === "storage" ||
          element.kind === "component" ||
          element.kind === "subsystem") &&
        !element.multiple &&
        depth(element) < 4,
    );
    const parent = containers.length && r.chance(0.55) ? r.pick(containers) : null;
    const allowed = !parent
      ? design
        ? [
            "agent",
            "agent",
            "storage",
            "storage",
            "human",
            "group",
            "component",
            "component",
            "subsystem",
            "class",
          ]
        : ["agent", "agent", "agent", "storage", "storage", "human", "group"]
      : parent.kind === "storage" || (parent.kind === "group" && parent.passive)
        ? ["storage"]
        : parent.kind === "component"
          ? ["component", "class", "storage"]
          : parent.kind === "subsystem"
            ? ["component", "class", "storage", "subsystem"]
            : design
              ? ["agent", "storage", "component", "class", "storage"]
              : ["agent", "agent", "storage", "storage", "human"];
    const kind = r.pick(allowed);
    const element: Element = {
      id: `n${next++}`,
      kind,
      parent,
      children: [],
      passive: kind === "storage",
      multiple: false,
    };
    if (kind === "group") element.passive = r.chance(0.4);
    (parent ? parent.children : roots).push(element);
    elements.push(element);
  }
  // A group needs members: give empty ones a member of the right kind.
  for (const element of elements.slice()) {
    if (element.kind !== "group" || element.children.length) continue;
    const child: Element = {
      id: `n${next++}`,
      kind: element.passive ? "storage" : "agent",
      parent: element,
      children: [],
      passive: element.passive,
      multiple: false,
    };
    element.children.push(child);
    elements.push(child);
  }

  // A group of storages is a storage group, as the parser decides; innermost first.
  for (const element of elements.toReversed())
    if (element.kind === "group")
      element.passive = element.children.every((child) => child.passive);
  const lines: string[] = [];
  if (r.chance(0.7)) lines.push(`title ${label() || "Untitled"}`.replace(/<br>/g, " "));
  if (direction !== "TB" || r.chance(0.3)) lines.push(`direction ${direction}`);
  const write = (element: Element, indent: string) => {
    const leaf = !element.children.length;
    const modifiers: string[] = [];
    if (r.chance(0.1)) modifiers.push(`:::${r.pick(COLORS)}`);
    if (["agent", "human", "storage"].includes(element.kind)) {
      if (leaf && r.chance(0.08)) {
        modifiers.push("...");
        element.multiple = true;
      } else if (r.chance(0.08)) modifiers.push("stack");
    }
    const text =
      element.kind === "group" ? (r.chance(0.3) ? `[${label() || "Group"}]` : "") : `[${label()}]`;
    const id = element.kind === "group" && !text && r.chance(0.5) ? "" : ` ${element.id}`;
    if (!id) element.id = "";
    lines.push(
      `${indent}${element.kind}${id}${text}${modifiers.map((modifier) => (modifier.startsWith(":::") ? modifier : ` ${modifier}`)).join("")}${leaf ? "" : " {"}`,
    );
    element.children.forEach((child, index) => {
      write(child, `${indent}  `);
      // Standalone dots between two leaf siblings of one kind.
      const following = element.children[index + 1];
      if (
        following &&
        !child.children.length &&
        !following.children.length &&
        child.kind === following.kind &&
        r.chance(0.15)
      )
        lines.push(`${indent}  ...`);
    });
    if (!leaf) lines.push(`${indent}}`);
  };
  roots.forEach((element) => write(element, ""));

  // Connections between named elements, chosen to be valid TAM.
  const named = elements.filter((element) => element.id);
  const active = (element: Element) =>
    !["storage", "group"].includes(element.kind) || (element.kind === "group" && !element.passive);
  /** Whether an element can be the end of a channel: an agent, or a group of agents and storages. */
  const talks = (element: Element): boolean =>
    element.kind === "agent" ||
    element.kind === "human" ||
    (element.kind === "group" &&
      !element.passive &&
      elements
        .filter((item) => item.parent === element)
        .every((item) => item.kind === "storage" || talks(item)));
  const ancestor = (a: Element, b: Element) => {
    for (let p = b.parent; p; p = p.parent) if (p === a) return true;
    return false;
  };
  const used = new Set<string>();
  const connections = r.int(
    Math.floor(named.length / 2),
    Math.max(1, Math.floor(named.length * 1.6)),
  );
  for (let i = 0; i < connections * 3 && used.size < connections; i++) {
    const a = r.pick(named),
      b = r.pick(named);
    if (a === b || used.has(`${a.id}|${b.id}`)) continue;
    const nested = ancestor(a, b) || ancestor(b, a);
    const text = r.chance(0.35) ? `: ${label() || "call"}` : "";
    const protocol = r.chance(0.15) ? ` @${r.pick(PROTOCOLS)}` : "";
    // The edge text: the word, then the label and protocol inside the edge.
    const edge = (word: string, withProtocol = true) =>
      `${word}${text}${withProtocol ? protocol : ""}`;
    let line: string | null = null;
    if (nested) {
      // Only a delegation connects a container to its part.
      if (design && active(a) && active(b) && ancestor(a, b) && a.kind !== "human")
        line = `${a.id} -- delegates --> ${b.id}`;
    } else if (active(a) && active(b)) {
      const kind = r.pick([
        "channel",
        "data",
        "data back",
        "data both",
        "calls",
        "calls",
        "calls",
        "calls back",
        "calls both",
      ]);
      const plain = `${text.slice(2)}${protocol}`.trim();
      line =
        kind === "channel"
          ? plain
            ? `${a.id} -- ${plain} --- ${b.id}`
            : `${a.id} --- ${b.id}`
          : kind.endsWith("both")
            ? // Data flows one way on a channel; requests go both ways.
              `${a.id} <-- ${edge("calls")} --> ${b.id}`
            : kind.endsWith("back")
              ? `${b.id} -- ${edge(kind.startsWith("data") ? "sends data" : "calls")} --> ${a.id}`
              : `${a.id} -- ${edge(kind === "data" ? "sends data" : "calls")} --> ${b.id}`;
      // Channels join agents only; components, subsystems and classes connect through interfaces.
      const channel = talks(a) && talks(b),
        people = a.kind === "human" || b.kind === "human";
      if (design && r.chance(0.25) && !people)
        line = `${a.id} -- requires${r.chance(0.1) ? "" : ` I${r.pick(WORDS)}`}${protocol} --> ${b.id}`;
      else if (r.chance(0.05)) line = `${a.id} -. create .-> ${b.id}`;
      else if (!channel)
        line = people
          ? `${a.id} -. create .-> ${b.id}`
          : `${a.id} -- requires I${WORDS[i % WORDS.length]}${protocol} --> ${b.id}`;
    } else if (active(a) !== active(b)) {
      const [agent, storage] = active(a) ? [a, b] : [b, a];
      line = `${agent.id} -- ${edge(r.pick(["reads", "writes", "reads/writes", "reads/writes"]), false)} --> ${storage.id}`;
    } else if (r.chance(0.3)) {
      line = `${a.id} -. pointer .-> ${b.id}`;
    }
    if (!line) continue;
    used.add(`${a.id}|${b.id}`);
    used.add(`${b.id}|${a.id}`);
    lines.push(line);
  }
  if (design)
    for (const element of named
      .filter((item) => ["component", "subsystem"].includes(item.kind))
      .slice(0, 3)) {
      if (r.chance(0.3))
        lines.push(`${element.id} ${r.pick(["provides", "requires"])} I${r.pick(WORDS)}`);
    }
  return lines.join("\n");

  function depth(element: Element) {
    let value = 0;
    for (let p = element.parent; p; p = p.parent) value++;
    return value;
  }
}

/** One TAM rule violation to inject into a valid diagram, with the error it must produce. */
export interface Violation {
  name: string;
  lines: string[];
  error: RegExp;
}

/**
 * Invalid additions for a diagram: each breaks exactly one TAM rule. Ids are fresh, so the rest of
 * the diagram stays valid and the error must point at the injected line.
 */
export const VIOLATIONS: Violation[] = [
  {
    name: "request between storages",
    lines: ["storage zs1", "storage zs2", "zs1 -- calls --> zs2"],
    error: /`zs1` is a storage/,
  },
  {
    name: "channel to a storage",
    lines: ["agent za1", "storage zs1", "za1 --- zs1"],
    error: /`zs1` is a storage/,
  },
  {
    name: "storage access between storages",
    lines: ["storage zs1", "storage zs2", "zs1 -- writes --> zs2"],
    error: /`writes` goes from an active element to a storage/,
  },
  {
    name: "storage acting",
    lines: ["storage zs1", "agent za1", "zs1 -- reads --> za1"],
    error: /`zs1` is a storage and does not act/,
  },
  {
    name: "unknown word",
    lines: ["agent za1", "agent za2", "za1 -- talks --> za2"],
    error: /`talks` is no connection word/,
  },
  {
    name: "storage holding an agent",
    lines: ["storage zs1 {", "  agent za1", "}"],
    error: /Storage `zs1` cannot contain the active element `za1`/,
  },
  {
    name: "human holding an element",
    lines: ["human zh1 {", "  agent za1", "}"],
    error: /Human agent `zh1` cannot contain elements/,
  },
  {
    name: "component holding an agent",
    lines: ["component zc1 {", "  agent za1", "}"],
    error: /Component `zc1` can contain components, classes and storages, not the agent `za1`/,
  },
  {
    name: "pointer between agents",
    lines: ["agent za1", "agent za2", "za1 -. pointer .-> za2"],
    error: /A «pointer» dependency connects two storages/,
  },
  {
    name: "create from a storage",
    lines: ["storage zs1", "agent za1", "zs1 -. create .-> za1"],
    error: /A «create» dependency connects active elements/,
  },
  {
    name: "connection inside a container",
    lines: ["agent za1 {", "  agent za2", "}", "za1 -- calls --> za2"],
    error: /`za1` contains `za2`/,
  },
  {
    name: "unknown element",
    lines: ["agent za1", "za1 -- calls --> zmissing"],
    error: /Unknown element `zmissing`/,
  },
  { name: "duplicate id", lines: ["agent za1", "agent za1"], error: /`za1` is already declared/ },
  {
    name: "multiple component",
    lines: ["component zc1 ..."],
    error: /Only agents and storages can be shown as multiple/,
  },
  {
    name: "dots between different kinds",
    lines: ["agent za1", "...", "storage zs1"],
    error: /`\.\.\.` stands between elements of one kind/,
  },
  {
    name: "self connection",
    lines: ["agent za1", "za1 --- za1"],
    error: /`za1` cannot connect to itself/,
  },
  {
    name: "arrow without a word",
    lines: ["agent za1", "agent za2", "za1 --> za2"],
    error: /has no connection word/,
  },
  {
    name: "interface on a storage",
    lines: ["storage zs1", "zs1 provides IThing"],
    error: /Only components, subsystems, classes and agents provide interfaces/,
  },
];

// Mermaid UML sources.

type Random = ReturnType<typeof random>;

export function words(r: Random, count = r.pick([1, 1, 2, 2, 3, 5])) {
  return Array.from({ length: count }, () =>
    r.chance(0.08) ? r.pick(LONG) : r.chance(0.06) ? r.pick(UNICODE) : r.pick(WORDS).toLowerCase(),
  ).join(" ");
}

export interface UmlFuzzOptions {
  size?: number;
  direction?: "TB" | "LR" | "BT" | "RL";
}

export const TYPES = ["int", "String", "bool", "Money", "List~int~", "Map~String, int~", "UUID"];
export const VERBS = ["load", "save", "validate", "send", "compute", "refresh", "cancel", "notify"];

export function generateStateDiagram(seed: number, options: UmlFuzzOptions = {}): string {
  const r = random(seed);
  const count = options.size ?? r.int(2, 18);
  const lines = ["stateDiagram-v2"];
  const direction = options.direction ?? r.pick(["TB", "TB", "TB", "LR"] as const);
  if (direction !== "TB") lines.push(`  direction ${direction}`);
  let next = 0;
  // No self transitions on choices (UML has none; Mermaid draws those).
  const choices = new Set<string>();
  const label = () =>
    r.chance(0.5)
      ? ` : ${words(r)}${r.chance(0.2) ? ` [${words(r, 1)}]` : ""}${r.chance(0.2) ? ` / ${words(r, 2)}` : ""}`
      : "";
  // A scope: states, transitions between them, optionally composites and regions inside.
  const scope = (indent: string, size: number, depth: number) => {
    const states: string[] = [];
    for (let i = 0; i < size; i++) {
      const id = `S${next++}`;
      states.push(id);
      const kind = r.next();
      let composite = false;
      if (kind < 0.08) {
        lines.push(`${indent}state ${id} <<choice>>`);
        choices.add(id);
      } else if (kind < 0.13) lines.push(`${indent}state ${id} <<${r.pick(["fork", "join"])}>>`);
      else if (kind < 0.25 && depth < 2 && size > 1) {
        composite = true;
        lines.push(`${indent}state ${r.chance(0.5) ? `"${words(r, 2)}" as ` : ""}${id} {`);
        const regions = r.chance(0.25) ? 2 : 1;
        for (let region = 0; region < regions; region++) {
          if (region) lines.push(`${indent}  --`);
          scope(`${indent}  `, r.int(1, 3), depth + 1);
        }
        lines.push(`${indent}}`);
      } else if (r.chance(0.3)) lines.push(`${indent}state "${words(r, r.int(1, 4))}" as ${id}`);
      // Composite states have a name only (Mermaid rejects descriptions on them).
      if (!composite && r.chance(0.1)) lines.push(`${indent}${id} : ${words(r)}`);
    }
    lines.push(`${indent}[*] --> ${states[0]}`);
    for (let i = 1; i < states.length; i++)
      lines.push(`${indent}${r.pick(states.slice(0, i))} --> ${states[i]}${label()}`);
    for (let i = r.int(0, Math.ceil(states.length / 2)); i > 0; i--) {
      const source = r.pick(states),
        target = r.pick(states);
      if (source !== target || !choices.has(source))
        lines.push(`${indent}${source} --> ${target}${label()}`);
    }
    if (r.chance(0.7)) lines.push(`${indent}${r.pick(states)} --> [*]`);
    if (r.chance(0.15))
      lines.push(`${indent}note ${r.pick(["left", "right"])} of ${r.pick(states)} : ${words(r)}`);
  };
  scope("  ", count, 0);
  return lines.join("\n");
}

export function generateFlowchart(
  seed: number,
  options: UmlFuzzOptions & { swimlanes?: boolean } = {},
): string {
  const r = random(seed);
  const count = options.size ?? r.int(2, 26);
  const swimlanes = options.swimlanes ?? false;
  const direction = options.direction ?? r.pick(["TB", "TB", "TD", "LR", "BT", "RL"] as const);
  const lines = [
    swimlanes
      ? `swimlane-beta ${direction === "TD" || direction === "BT" ? "TB" : direction === "RL" ? "LR" : direction}`
      : `${r.pick(["flowchart", "graph"])} ${direction}`,
  ];
  const shapes = [
    ["[", "]"],
    ["(", ")"],
    ["([", "])"],
    ["[[", "]]"],
    ["[(", ")]"],
    ["((", "))"],
    ["{", "}"],
    ["{{", "}}"],
    ["[/", "/]"],
    ["[\\", "\\]"],
    [">", "]"],
    ["(((", ")))"],
  ];
  const ids = Array.from({ length: count }, (_, index) => `n${index}`);
  const declared = new Set<string>();
  // Decisions and start/end symbols: no self loops on them (UML has none; Mermaid draws those).
  const symbols = new Set<string>();
  const ref = (id: string) => {
    if (declared.has(id) || r.chance(0.3)) return id;
    declared.add(id);
    if (r.chance(0.06)) {
      const shape = r.pick(["fork", "join", "start", "stop", "cross-circ", "diam"]);
      if (!["fork", "join"].includes(shape)) symbols.add(id);
      return `${id}@{ shape: ${shape} }`;
    }
    const [open, close] = r.chance(0.5) ? ["(", ")"] : r.pick(shapes);
    if (open === "{" || open === "((" || open === "(((") symbols.add(id);
    const text = r.chance(0.1) ? " " : words(r, r.int(1, 5));
    return `${id}${open}${r.chance(0.2) ? `"${text}"` : text}${close}`;
  };
  // Subgraphs (lanes): contiguous runs of nodes.
  const groups = swimlanes ? r.int(1, 4) : r.chance(0.35) ? r.int(1, 3) : 0;
  const home = new Map(ids.map((id) => [id, groups ? r.int(-1, groups - 1) : -1]));
  const edge = () => {
    const kind = r.pick(["-->", "-->", "-->", "---", "-.->", "==>", "--o", "--x", "<-->"]);
    const label = r.chance(0.3) ? words(r, r.int(1, 3)) : "";
    if (!label) return ` ${kind} `;
    return r.chance(0.5)
      ? ` ${kind}|${label}| `
      : kind === "-->"
        ? ` -- ${label} --> `
        : ` ${kind}|${label}| `;
  };
  for (let group = 0; group < groups; group++) {
    lines.push(`  subgraph g${group}${r.chance(0.6) ? ` [${words(r, r.int(1, 3))}]` : ""}`);
    for (const id of ids.filter((item) => home.get(item) === group)) lines.push(`    ${ref(id)}`);
    lines.push("  end");
  }
  for (const id of ids.filter((item) => home.get(item) === -1)) lines.push(`  ${ref(id)}`);
  for (let i = 1; i < count; i++) lines.push(`  ${ids[r.int(0, i - 1)]}${edge()}${ids[i]}`);
  for (let i = r.int(0, Math.ceil(count / 3)); i > 0; i--) {
    const source = r.pick(ids),
      target = r.pick(ids);
    if (source !== target || !symbols.has(source)) lines.push(`  ${source}${edge()}${target}`);
  }
  if (r.chance(0.2)) {
    const [a, b, target] = [r.pick(ids), r.pick(ids), r.pick(ids)];
    if (!((a === target || b === target) && symbols.has(target)))
      lines.push(`  ${a} & ${b} --> ${target}`);
  }
  return lines.join("\n");
}

const ARROWS = [
  "->>",
  "->>",
  "-->>",
  "-->>",
  "->",
  "-->",
  "-x",
  "--x",
  "-)",
  "--)",
  "<<->>",
  "<<-->>",
];
const FRAMES: Record<string, string | null> = {
  loop: null,
  alt: "else",
  opt: null,
  par: "and",
  critical: "option",
  break: null,
  rect: null,
};

/** Random sequence diagrams: actors, boxes, every arrow, activations, notes, nested fragments, numbering, creation and destruction. */
export function generateSequenceDiagram(seed: number, options: UmlFuzzOptions = {}): string {
  const r = random(seed);
  const count = options.size ?? r.int(2, 7);
  const lines = ["sequenceDiagram"];
  if (r.chance(0.5)) lines.push("  autonumber");
  const ids = Array.from({ length: count }, (_, index) => `P${index}`);
  let boxed = 0;
  for (let index = 0; index < ids.length; index++) {
    if (!boxed && r.chance(0.15) && index < ids.length - 1) {
      boxed = r.int(1, Math.min(3, ids.length - index));
      lines.push(`  box ${r.chance(0.7) ? words(r, 2) : ""}`.trimEnd());
    }
    const kind = r.chance(0.25) ? "actor" : "participant";
    lines.push(
      `  ${boxed ? "  " : ""}${kind} ${ids[index]}${r.chance(0.5) ? ` as ${words(r)}` : ""}`,
    );
    if (boxed && --boxed === 0) lines.push("  end");
  }
  const active = new Map(ids.map((id) => [id, 0]));
  const frames: { kind: string; messages: number }[] = [];
  const indent = () => "  ".repeat(frames.length + 1);
  const created = new Set<string>(),
    destroyed = new Set<string>();
  const alive = () => ids.filter((id) => !destroyed.has(id));
  const message = (from: string, to: string) => {
    const arrow = r.pick(ARROWS),
      self = from === to;
    const activate = !self && r.chance(0.3) ? "+" : "";
    const deactivate = !activate && !self && active.get(from)! > 0 && r.chance(0.4) ? "-" : "";
    if (activate) active.set(to, active.get(to)! + 1);
    if (deactivate) active.set(from, active.get(from)! - 1);
    lines.push(
      `${indent()}${from}${arrow}${activate || deactivate}${to}: ${r.chance(0.9) ? words(r) : ""}`.trimEnd(),
    );
    frames.forEach((frame) => frame.messages++);
  };
  const steps = r.int(3, 30);
  for (let step = 0; step < steps; step++) {
    const choice = r.next(),
      people = alive();
    if (people.length < 2) break;
    const a = r.pick(people),
      others = people.filter((id) => id !== a),
      b = r.pick(others);
    if (choice < 0.55) message(a, r.chance(0.1) ? a : b);
    else if (choice < 0.65) {
      const placement = r.pick(["left of", "right of", "over"]);
      const neighbour = ids[ids.indexOf(a) + 1];
      const who =
        placement === "over" && neighbour && !destroyed.has(neighbour) && r.chance(0.4)
          ? `${a},${neighbour}`
          : a;
      lines.push(`${indent()}Note ${placement} ${who}: ${words(r)}`);
    } else if (choice < 0.72) {
      if (active.get(a)! > 0 && r.chance(0.5)) {
        lines.push(`${indent()}deactivate ${a}`);
        active.set(a, active.get(a)! - 1);
      } else {
        lines.push(`${indent()}activate ${a}`);
        active.set(a, active.get(a)! + 1);
      }
    } else if (choice < 0.84 && frames.length < 3) {
      const kind = r.pick(Object.keys(FRAMES));
      lines.push(
        `${indent()}${kind}${kind === "rect" ? " rgb(200, 220, 255)" : r.chance(0.8) ? ` ${words(r)}` : ""}`,
      );
      frames.push({ kind, messages: 0 });
      message(a, b);
    } else if (choice < 0.9 && frames.length) {
      const frame = frames.at(-1)!,
        branch = FRAMES[frame.kind];
      if (branch && frame.messages) {
        lines.push(`${"  ".repeat(frames.length)}${branch}${r.chance(0.8) ? ` ${words(r)}` : ""}`);
        frame.messages = 0;
        message(a, b);
      } else if (frame.messages) {
        frames.pop();
        lines.push(`${indent()}end`);
      }
    } else if (choice < 0.95) {
      const id = `N${created.size}`;
      created.add(id);
      ids.push(id);
      active.set(id, 0);
      lines.push(`${indent()}create ${r.chance(0.3) ? "actor" : "participant"} ${id}`);
      message(a, id);
    } else if (active.get(b) === 0 && alive().length > 2 && !frames.length) {
      lines.push(`${indent()}destroy ${b}`);
      message(a, b);
      destroyed.add(b);
    }
  }
  while (frames.length) {
    if (!frames.at(-1)!.messages) {
      const people = alive();
      message(people[0], people[1] ?? people[0]);
    }
    frames.pop();
    lines.push(`${indent()}end`);
  }
  return lines.join("\n");
}
