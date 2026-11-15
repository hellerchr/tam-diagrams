import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { USECASE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseUseCaseDiagram } from "../src/uml-usecase.ts";
import {
  addUseCasePiece,
  connectUseCase,
  labelUseCaseRelation,
  relinkUseCase,
  removeUseCase,
  renameUseCase,
  usecaseStructure,
} from "../src/uml-usecase-edit.ts";

const SHOP = `usecase-beta
  direction LR
  actor User
  actor Admin
  systemBoundary shop[Web Shop]
    browse(Browse Products)
    order(Place Order)
    manage(Manage Catalog)
  end
  User --> browse
  User --> order
  Admin --> manage`;

/** Frontmatter, comments, blank lines, a list of actors, relations that declare, and a note. */
const MIXED = `---
title: Mixed
---
%% the people
usecase-beta
  actor Guest, Member("Club member") <<human>>, bot("Robot") <<system>>

  %% what they do
  systemBoundary "Club"
      enter(Enter)
      %% inside
      pay[Pay fee]
  end
  actor Owner --> pay
  Guest -- asks --> enter
  enter <-- Member
  enter ..> : include pay
  "Log out" --|> enter
  bot --o late(Remind)
  note for pay "only once"
  style pay fill:#eee
`;

const relations = (source: string) =>
  parseUseCaseDiagram(source).relations.map(
    (item) => `${item.source}>${item.target}:${item.kind}${item.label ? `:${item.label}` : ""}`,
  );

const element = (source: string, id: string) => parseUseCaseDiagram(source).elements.get(id);

/** The lines of a source that another source no longer has. */
const changed = (before: string, after: string) => {
  const kept = new Set(after.split("\n"));
  return before.split("\n").filter((line) => !kept.has(line));
};

describe("editing a use case diagram as text", () => {
  it("adds use cases, actors, boundaries and notes", () => {
    const useCase = addUseCasePiece(SHOP, { kind: "usecase", label: "Pay" });
    expect(useCase.id).toBe("usecase1");
    expect(useCase.source).toBe(`${SHOP}\n  usecase1(Pay)`);
    // At a boundary a use case goes inside it, indented as the others there.
    const inside = addUseCasePiece(SHOP, { kind: "usecase", label: "Pay", parent: "shop" });
    expect(inside.source).toContain("    manage(Manage Catalog)\n    usecase1(Pay)\n  end\n");
    expect(element(inside.source, "usecase1")).toMatchObject({ boundary: "shop", label: "Pay" });
    expect(addUseCasePiece(SHOP, { kind: "usecase" }).source).toContain("usecase1(Use case)");
    // An actor stands outside, also when added at a boundary.
    const actor = addUseCasePiece(SHOP, { kind: "actor", label: "Clerk", parent: "shop" });
    expect(actor.id).toBe("actor1");
    expect(actor.source.endsWith("\n  actor actor1(Clerk)")).toBe(true);
    expect(element(actor.source, "actor1")).toMatchObject({ kind: "actor", boundary: null });
    const boundary = addUseCasePiece(SHOP, { kind: "boundary", label: "Bank", parent: "shop" });
    expect(boundary.id).toBe("system1");
    expect(boundary.source.endsWith("\n  systemBoundary system1[Bank]\n  end")).toBe(true);
    expect(parseUseCaseDiagram(boundary.source).boundaries.get("system1")!.label).toBe("Bank");
    // Ids stay fresh, and the blank line at the end stays the end.
    const second = addUseCasePiece(useCase.source, { kind: "usecase" });
    expect(second.id).toBe("usecase2");
    const mixed = addUseCasePiece(MIXED, { kind: "actor" });
    expect(mixed.source.endsWith("  style pay fill:#eee\n  actor actor1(Actor)\n")).toBe(true);
    // In a boundary whose lines are indented deeper, so is the new one.
    expect(addUseCasePiece(MIXED, { kind: "usecase", parent: "Club" }).source).toContain(
      "      pay[Pay fee]\n      usecase1(Use case)\n  end",
    );
  });

  it("adds a note to the last element, of the boundary when given", () => {
    const note = addUseCasePiece(SHOP, { kind: "note", label: 'Say "hi"' });
    expect(note.id).toBe("note1");
    expect(note.source.endsWith('\n  note for manage "Say #quot;hi#quot;"')).toBe(true);
    expect(parseUseCaseDiagram(note.source).notes[0]).toMatchObject({
      target: "manage",
      text: 'Say "hi"',
    });
    expect(addUseCasePiece(MIXED, { kind: "note", parent: "Club" }).id).toBe("note2");
    expect(addUseCasePiece(MIXED, { kind: "note", parent: "Club" }).source).toContain(
      'note for pay "Note"',
    );
    // Without an element there is nothing to hang it on.
    expect(addUseCasePiece("usecase-beta", { kind: "note" })).toEqual({
      source: "usecase-beta",
      id: "",
    });
  });

  it("connects elements with every kind of relation", () => {
    expect(connectUseCase(SHOP, "Admin", "order")).toBe(`${SHOP}\n  Admin --> order`);
    expect(relations(connectUseCase(SHOP, "order", "browse", "include")).at(-1)).toBe(
      "order>browse:include:«include»",
    );
    expect(relations(connectUseCase(SHOP, "manage", "order", "extend")).at(-1)).toBe(
      "manage>order:extend:«extend»",
    );
    expect(relations(connectUseCase(SHOP, "Admin", "User", "generalization")).at(-1)).toBe(
      "Admin>User:generalization",
    );
    // A quoted name is its own id.
    expect(connectUseCase(MIXED, "Guest", "Log out")).toContain('\n  Guest --> "Log out"\n');
    // Boundaries and unknown ids take no relation.
    expect(connectUseCase(SHOP, "User", "shop")).toBe(SHOP);
    expect(connectUseCase(SHOP, "User", "nobody")).toBe(SHOP);
  });

  it("hangs a note on the element it is connected to", () => {
    const moved = connectUseCase(MIXED, "note1", "enter");
    expect(moved).toContain('  note for enter "only once"\n');
    expect(changed(MIXED, moved)).toEqual(['  note for pay "only once"']);
    expect(connectUseCase(MIXED, "Guest", "note1")).toContain('note for Guest "only once"');
    // After an element that a later line declares, so the parser knows it.
    const early = `usecase-beta\n  a(A)\n  note for a "N"\n  b(B)`;
    expect(connectUseCase(early, "note1", "b")).toBe(
      `usecase-beta\n  a(A)\n  b(B)\n  note for b "N"`,
    );
    expect(connectUseCase(MIXED, "note1", "Log out")).toBe(MIXED);
    expect(connectUseCase(MIXED, "note1", "Club")).toBe(MIXED);
  });

  it("renames by the label and leaves the id", () => {
    const actor = renameUseCase(SHOP, "User", "Customer");
    expect(actor).toContain("  actor User(Customer)\n");
    expect(changed(SHOP, actor)).toEqual(["  actor User"]);
    expect(relations(actor)).toEqual(relations(SHOP));
    expect(renameUseCase(SHOP, "browse", "Look around")).toContain("    browse(Look around)\n");
    expect(renameUseCase(SHOP, "shop", "Store")).toContain("  systemBoundary shop[Store]\n");
    // In a list of actors, with what follows the name kept.
    expect(renameUseCase(MIXED, "Member", "Patron")).toContain(
      '  actor Guest, Member(Patron) <<human>>, bot("Robot") <<system>>\n',
    );
    expect(renameUseCase(MIXED, "Guest", "Visitor")).toContain("  actor Guest(Visitor), Member(");
    // A box keeps its brackets, a label on a relation's line is written there.
    expect(renameUseCase(MIXED, "pay", "Pay up")).toContain("      pay[Pay up]\n");
    expect(renameUseCase(MIXED, "late", "Nag")).toContain("  bot --o late(Nag)\n");
    expect(renameUseCase(MIXED, "Owner", "Boss")).toContain("  actor Owner(Boss) --> pay\n");
    // Only mentioned: where it first stands, it gets its label.
    const bare = "usecase-beta\n  actor A\n  A --> b\n  b --> c";
    expect(renameUseCase(bare, "b", "Bee")).toBe(
      "usecase-beta\n  actor A\n  A --> b(Bee)\n  b --> c",
    );
    // An empty name leaves the id as the name.
    expect(renameUseCase(SHOP, "browse", " ")).toContain("    browse\n");
    expect(renameUseCase(SHOP, "shop", "")).toContain("  systemBoundary shop\n");
    expect(renameUseCase(SHOP, "nobody", "x")).toBe(SHOP);
  });

  it("renames a quoted name wherever it stands", () => {
    const renamed = renameUseCase(`${MIXED}  Guest --> "Log out"\n`, "Log out", "Sign off");
    expect(renamed).toContain('  "Sign off" --|> enter\n');
    expect(renamed).toContain('  Guest --> "Sign off"\n');
    expect(element(renamed, "Log out")).toBeUndefined();
    expect(element(renamed, "Sign off")!.label).toBe("Sign off");
    // A quoted name that would do as an id is one: it gets a label.
    const club = renameUseCase(MIXED, "Club", "Society");
    expect(club).toContain("  systemBoundary Club[Society]\n");
    expect(element(club, "enter")!.boundary).toBe("Club");
    const spaced = 'usecase-beta\n  systemBoundary "My Club"\n    a(A)\n  end';
    expect(renameUseCase(spaced, "My Club", "Our Club")).toContain('  systemBoundary "Our Club"\n');
    // A name another element has is not taken.
    expect(renameUseCase(MIXED, "Log out", "enter")).toBe(MIXED);
    expect(renameUseCase(MIXED, "note1", "at most once")).toContain(
      '  note for pay "at most once"\n',
    );
  });

  it("writes labels with special characters so that they read back the same", () => {
    const names = [
      "Pay (now)",
      "Items [all]",
      'Say "hi"',
      "a < b > c",
      "<b>bold</b>",
      "50% & more; #1",
      "R&D #amp; &lt;",
      "Größe: 注文, ok",
      "x :: y @{ z } <<q>>",
      "pre-order",
    ];
    for (const name of names) {
      for (const id of ["browse", "User", "shop"]) {
        const renamed = usecaseStructure.rename(SHOP, id, name);
        expect(
          usecaseStructure.read(renamed).nodes.find((node) => node.id === id)!.label,
          `${id}: ${name}`,
        ).toBe(name);
        expect(changed(SHOP, renamed)).toHaveLength(1);
      }
      const added = addUseCasePiece(SHOP, { kind: "usecase", label: name, parent: "shop" });
      expect(element(added.source, added.id)!.label).toBe(name);
      const labelled = labelUseCaseRelation(SHOP, "r1", name);
      expect(parseUseCaseDiagram(labelled).relations[0], name).toMatchObject({
        source: "User",
        target: "browse",
        label: name,
      });
      const note = renameUseCase(MIXED, "note1", name);
      expect(parseUseCaseDiagram(note).notes[0].text).toBe(name);
    }
    expect(element(renameUseCase(SHOP, "browse", "two\nlines"), "browse")!.label).toBe(
      "two<br>lines",
    );
    expect(labelUseCaseRelation(SHOP, "r1", ">= 1 - 2")).toContain(
      "  User -- #gt;= 1 #45; 2 --> browse\n",
    );
  });

  it("labels associations and takes labels away", () => {
    const labelled = labelUseCaseRelation(SHOP, "r2", "places");
    expect(labelled).toContain("  User -- places --> order\n");
    expect(changed(SHOP, labelled)).toEqual(["  User --> order"]);
    expect(labelUseCaseRelation(MIXED, "r2", "begs")).toContain("  Guest -- begs --> enter\n");
    expect(labelUseCaseRelation(MIXED, "r2", "")).toContain("  Guest --> enter\n");
    expect(labelUseCaseRelation(SHOP, "r2", "")).toBe(SHOP);
    // The mark at the end stays; a line that declares keeps its declarations.
    expect(labelUseCaseRelation(MIXED, "r6", "nags")).toContain("  bot -- nags --o late(Remind)\n");
    expect(labelUseCaseRelation(MIXED, "r1", "is")).toContain("  actor Owner -- is --> pay\n");
    // An arrow that points back is written from its source.
    const back = labelUseCaseRelation(MIXED, "r3", "joins");
    expect(back).toContain("  Member -- joins --> enter\n");
    expect(back).not.toContain("enter <-- Member");
    expect(relations(back)[2]).toBe("Member>enter:association:joins");
    // «include», «extend» and generalization carry no text of their own.
    expect(labelUseCaseRelation(MIXED, "r4", "x")).toBe(MIXED);
    expect(labelUseCaseRelation(MIXED, "r5", "x")).toBe(MIXED);
    expect(labelUseCaseRelation(SHOP, "r9", "x")).toBe(SHOP);
    // Marks at the start: the same picture without the text, as far as the syntax has it.
    const marks = "usecase-beta\n  a(A) <-- t -- b\n  c o-- t --> d\n  e1 e9@-- t --x f";
    expect(labelUseCaseRelation(marks, "r1", "")).toContain("  a(A)\n  b --> a\n");
    expect(labelUseCaseRelation(marks, "r2", "")).toContain("  c --> d\n");
    expect(labelUseCaseRelation(marks, "r3", "")).toContain("  e1 e9@--x f");
    expect(labelUseCaseRelation(marks, "r1", "u")).toContain("  a(A) <-- u -- b\n");
  });

  it("makes a relation one of another kind", () => {
    const include = relinkUseCase(MIXED, "r2", "include");
    expect(include).toContain("  Guest ..> : include enter\n");
    expect(changed(MIXED, include)).toEqual(["  Guest -- asks --> enter"]);
    expect(relinkUseCase(MIXED, "r4", "extend")).toContain("  enter ..> : extend pay\n");
    expect(relinkUseCase(MIXED, "r4", "association")).toContain("  enter --> pay\n");
    expect(relinkUseCase(MIXED, "r5", "association")).toContain('  "Log out" --> enter\n');
    expect(relinkUseCase(MIXED, "r1", "generalization")).toContain("  actor Owner --|> pay\n");
    expect(relinkUseCase(MIXED, "r6", "include")).toContain("  bot ..> : include late(Remind)\n");
    // An arrow that points back is written from its source, so the relation keeps its ends.
    const back = relinkUseCase(MIXED, "r3", "generalization");
    expect(back).toContain("  Member --|> enter\n");
    expect(relations(back)[2]).toBe("Member>enter:generalization");
    const declared = "usecase-beta\n  actor A, B <-- c(See)";
    expect(relinkUseCase(declared, "r1", "extend")).toBe(
      "usecase-beta\n  actor A, B\n  c(See) ..> : extend A",
    );
    // The kind it has, an unknown kind, an unknown relation: nothing changes.
    expect(relinkUseCase(MIXED, "r2", "association")).toBe(MIXED);
    expect(relinkUseCase(MIXED, "r2", "wavy")).toBe(MIXED);
    expect(relinkUseCase(MIXED, "r9", "include")).toBe(MIXED);
  });

  it("removes elements with their relations and notes", () => {
    const without = removeUseCase(SHOP, ["order"]);
    expect(changed(SHOP, without)).toEqual(["    order(Place Order)", "  User --> order"]);
    expect(relations(without)).toEqual(["User>browse:association", "Admin>manage:association"]);
    const noActor = removeUseCase(SHOP, ["User"]);
    expect(changed(SHOP, noActor)).toEqual([
      "  actor User",
      "  User --> browse",
      "  User --> order",
    ]);
    expect(element(noActor, "browse")).toBeDefined();
    // One of a list of actors; the others keep what follows their names.
    const listed = removeUseCase(MIXED, ["Member"]);
    expect(listed).toContain('  actor Guest, bot("Robot") <<system>>\n');
    expect(listed).not.toContain("enter <-- Member");
    // The use case goes with its note, its style, and the relations: the actor declared on such a line stays.
    const unpaid = removeUseCase(MIXED, ["pay"]);
    expect(unpaid).toContain("  actor Owner\n");
    expect(unpaid).not.toMatch(/note for|style pay|include|Pay fee/);
    expect(element(unpaid, "Owner")!.kind).toBe("actor");
    // An element that a removed relation's line declares keeps its declaration.
    const quiet = removeUseCase(MIXED, ["bot"]);
    expect(quiet).toContain('  actor Guest, Member("Club member") <<human>>\n');
    expect(quiet).toContain("  late(Remind)\n");
    expect(removeUseCase(MIXED, ["Log out"])).not.toContain("Log out");
    expect(removeUseCase(MIXED, ["note1"])).not.toContain("note for");
    expect(removeUseCase(MIXED, ["note1"])).toContain("style pay");
  });

  it("removes relations and keeps their elements", () => {
    const cut = removeUseCase(SHOP, ["r2"]);
    expect(changed(SHOP, cut)).toEqual(["  User --> order"]);
    expect(cut.split("\n")).toHaveLength(SHOP.split("\n").length - 1);
    expect(removeUseCase(MIXED, ["r1"])).toContain("  actor Owner\n  Guest -- asks");
    expect(removeUseCase(MIXED, ["r6"])).toContain("  late(Remind)\n");
    // The only line that names an element keeps naming it.
    const only = removeUseCase(MIXED, ["r5"]);
    expect(only).toContain('  "Log out"\n');
    expect(element(only, "Log out")).toBeDefined();
    const bare = "usecase-beta\n  a --> b\n  b --> c\n  a --> c";
    expect(removeUseCase(bare, ["r1"])).toBe("usecase-beta\n  b --> c\n  a --> c");
    expect(removeUseCase(bare, ["r1", "r2", "r3"])).toBe("usecase-beta\n  a\n  b\n  c");
    expect(removeUseCase(bare, ["b", "r3"])).toBe("usecase-beta\n  a\n  c");
  });

  it("removes a boundary with what it holds", () => {
    const open = removeUseCase(SHOP, ["shop"]);
    expect(open).toBe("usecase-beta\n  direction LR\n  actor User\n  actor Admin");
    const club = removeUseCase(MIXED, ["Club"]);
    expect(parseUseCaseDiagram(club).boundaries.size).toBe(0);
    expect([...parseUseCaseDiagram(club).elements.keys()]).toEqual([
      "Guest",
      "Member",
      "bot",
      "Owner",
      "Log out",
      "late",
    ]);
    expect(relations(club)).toEqual(["bot>late:association"]);
    expect(club).toContain("%% the people\n");
    expect(club).toContain("  %% what they do\n");
    // One of two boundaries: the other stays as it is.
    const two = USECASE_EXAMPLES.find(([name]) => name.includes("two systems"))![1];
    const one = removeUseCase(two, ["portal"]);
    expect(one).toContain("  systemBoundary clinic[Clinic system]\n    treat(Treat patient)\n");
    expect(relations(one)).toEqual([
      "Doctor>treat:association",
      "Doctor>order:association",
      "order>lab:association",
    ]);
  });
});

describe("a use case diagram as a structure", () => {
  const { pieces, links } = usecaseStructure;

  it("names its pieces and links, the usual one first", () => {
    expect(
      pieces.map((piece) => `${piece.kind}:${piece.joins ?? ""}:${piece.group ?? false}`),
    ).toEqual(["usecase:after:false", "actor:before:false", "boundary::true", "note:before:false"]);
    expect(links.map((link) => link.kind)).toEqual([
      "association",
      "include",
      "extend",
      "generalization",
    ]);
  });

  it("reads parts with boundaries before what they hold, and joins", () => {
    const { nodes, edges } = usecaseStructure.read(MIXED);
    expect(nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}`)).toEqual([
      "Guest:actor:null:6",
      "Member:actor:null:6",
      "bot:actor:null:6",
      "Club:boundary:null:9",
      "enter:usecase:Club:10",
      "pay:usecase:Club:12",
      "Owner:actor:null:14",
      "Log out:usecase:null:18",
      "late:usecase:null:19",
      "note1:note:null:20",
    ]);
    expect(nodes.filter((node) => node.group).map((node) => node.id)).toEqual(["Club"]);
    expect(nodes.find((node) => node.id === "Member")!.label).toBe("Club member");
    expect(edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}:${edge.kind}`)).toEqual([
      "r1:Owner>pay:association",
      "r2:Guest>enter:association",
      "r3:Member>enter:association",
      "r4:enter>pay:include",
      "r5:Log out>enter:generalization",
      "r6:bot>late:association",
    ]);
    expect(edges[1]).toMatchObject({ label: "asks", line: 15 });
    // A use case a line above its boundary already names still stands in it.
    const early = "usecase-beta\n  actor A\n  A --> x\n  systemBoundary s\n    x(X)\n  end";
    expect(usecaseStructure.read(early).nodes.map((node) => node.id)).toEqual(["A", "s", "x"]);
  });

  it("edits through one interface", () => {
    const added = usecaseStructure.add(SHOP, { kind: "usecase", label: "Pay", parent: "shop" });
    const joined = usecaseStructure.connect(added.source, "User", added.id);
    expect(usecaseStructure.read(joined).edges.at(-1)).toMatchObject({
      id: "r4",
      source: "User",
      target: "usecase1",
      kind: "association",
    });
    const extend = usecaseStructure.relink(joined, "r4", "extend");
    expect(usecaseStructure.read(extend).edges.at(-1)).toMatchObject({ kind: "extend" });
    const labelled = usecaseStructure.label(joined, "r4", "pays");
    expect(usecaseStructure.read(labelled).edges.at(-1)!.label).toBe("pays");
    const renamed = usecaseStructure.rename(labelled, "usecase1", "Pay now");
    expect(
      usecaseStructure.read(renamed).nodes.find((node) => node.id === "usecase1"),
    ).toMatchObject({ label: "Pay now", parent: "shop", kind: "usecase" });
    expect(usecaseStructure.remove(renamed, ["usecase1"])).toBe(SHOP);
    // An actor added at a use case leads to it.
    const actor = usecaseStructure.add(SHOP, { kind: "actor", label: "Clerk" });
    expect(
      usecaseStructure.read(usecaseStructure.connect(actor.source, actor.id, "order")).edges.at(-1),
    ).toMatchObject({ source: "actor1", target: "order" });
  });

  /** Every part is a shape of the scene, every join a wire. */
  const inScene = async (source: string) => {
    const { nodes, edges } = usecaseStructure.read(source),
      scene = await parseUml(source).layout(arialMeasure),
      shapes = new Set(scene.shapes.map((shape) => shape.id)),
      wires = new Set(scene.wires.map((wire) => wire.edge));
    for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
    for (const edge of edges) expect(wires.has(edge.id), edge.id).toBe(true);
    // The other way round: only the line from a note to its element is no join.
    expect([...shapes].toSorted()).toEqual(nodes.map((node) => node.id).toSorted());
    expect([...wires].filter((id) => !id.endsWith(":link")).toSorted()).toEqual(
      edges.map((edge) => edge.id).toSorted(),
    );
    return { nodes, edges };
  };

  it("reads parts and joins under the ids of the scene", async () => {
    await inScene(SHOP);
    await inScene(MIXED);
    // What the edits add is there under the id they return.
    for (const piece of pieces) {
      const added = usecaseStructure.add(MIXED, { kind: piece.kind, label: "New", parent: "Club" });
      const { nodes } = await inScene(added.source);
      expect(nodes.find((node) => node.id === added.id)).toMatchObject({
        kind: piece.kind,
        label: "New",
        group: piece.group ?? false,
      });
    }
    await inScene(usecaseStructure.connect(SHOP, "manage", "manage", "include"));
  });

  it("reads and edits every example", async () => {
    for (const [name, source] of USECASE_EXAMPLES) {
      const { nodes, edges } = await inScene(source);
      expect(nodes.length, name).toBeGreaterThan(0);
      const kinds = new Set(pieces.map((piece) => piece.kind));
      for (const node of nodes) expect(kinds.has(node.kind), node.kind).toBe(true);
      for (const node of nodes) {
        const without = usecaseStructure.remove(source, [node.id]),
          left = usecaseStructure.read(without);
        expect(() => parseUml(without), `${name}: ${node.id}`).not.toThrow();
        expect(left.nodes.some((other) => other.id === node.id && other.line === node.line)).toBe(
          false,
        );
        // What goes are the part, what it holds, and the notes on them; everything else stays.
        const held = nodes.filter((other) => other.parent === node.id || other.id === node.id);
        const notes = nodes.filter((other) => other.kind === "note").length;
        const lost = nodes.length - left.nodes.length;
        expect(lost, `${name}: ${node.id}`).toBeGreaterThanOrEqual(held.length);
        expect(lost, `${name}: ${node.id}`).toBeLessThanOrEqual(held.length + notes);
      }
      for (const edge of edges) {
        const without = usecaseStructure.remove(source, [edge.id]),
          left = usecaseStructure.read(without);
        expect(left.edges.length, `${name}: ${edge.id}`).toBe(edges.length - 1);
        expect(left.nodes.map((node) => node.id).toSorted()).toEqual(
          nodes.map((node) => node.id).toSorted(),
        );
        for (const link of links) {
          const relinked = usecaseStructure.relink(source, edge.id, link.kind);
          expect(
            usecaseStructure.read(relinked).edges.find((item) => item.id === edge.id),
          ).toMatchObject({ source: edge.source, target: edge.target, kind: link.kind });
        }
      }
      for (const node of nodes) {
        const renamed = usecaseStructure.rename(source, node.id, "Other (name)");
        expect(
          usecaseStructure.read(renamed).nodes.find((other) => other.id === node.id)!.label,
          `${name}: ${node.id}`,
        ).toBe("Other (name)");
      }
      await inScene(usecaseStructure.remove(source, [nodes[0].id, edges.at(-1)!.id]));
    }
  });
});
