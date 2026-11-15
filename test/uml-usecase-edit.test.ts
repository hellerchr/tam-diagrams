import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { USECASE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseUseCaseDiagram } from "../src/uml-usecase.ts";
import {
  addUseCasePiece,
  attachUsecase,
  connectUseCase,
  duplicateUsecasePart,
  isGeneratedUsecaseId,
  joinUseCase,
  labelUseCaseRelation,
  moveUsecaseInto,
  relinkUseCase,
  removeUseCase,
  renameUseCase,
  renameUsecaseId,
  reverseUsecaseRelation,
  ungroupUsecaseBoundary,
  type UseCaseEdge,
  usecaseRemovalSummary,
  usecaseStructure,
  whyNotUsecase,
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
    // Outside the boundaries a use case stands before the relations.
    expect(useCase.source).toBe(
      SHOP.replace("  User --> browse\n", "  usecase1(Pay)\n  User --> browse\n"),
    );
    // At a boundary a use case goes inside it, indented as the others there.
    const inside = addUseCasePiece(SHOP, { kind: "usecase", label: "Pay", parent: "shop" });
    expect(inside.source).toContain("    manage(Manage Catalog)\n    usecase1(Pay)\n  end\n");
    expect(element(inside.source, "usecase1")).toMatchObject({ boundary: "shop", label: "Pay" });
    expect(addUseCasePiece(SHOP, { kind: "usecase" }).source).toContain("usecase1(Use case)");
    // An actor stands outside, also when added at a boundary.
    const actor = addUseCasePiece(SHOP, { kind: "actor", label: "Clerk", parent: "shop" });
    expect(actor.id).toBe("actor1");
    expect(actor.source).toBe(
      SHOP.replace("  actor Admin\n", "  actor Admin\n  actor actor1(Clerk)\n"),
    );
    expect(element(actor.source, "actor1")).toMatchObject({ kind: "actor", boundary: null });
    const boundary = addUseCasePiece(SHOP, { kind: "boundary", label: "Bank", parent: "shop" });
    expect(boundary.id).toBe("system1");
    expect(boundary.source).toBe(
      SHOP.replace("  end\n", "  end\n  systemBoundary system1[Bank]\n  end\n"),
    );
    expect(parseUseCaseDiagram(boundary.source).boundaries.get("system1")!.label).toBe("Bank");
    // Ids stay fresh, and each stands after the last of its kind.
    const second = addUseCasePiece(useCase.source, { kind: "usecase" });
    expect(second.id).toBe("usecase2");
    expect(second.source).toContain("  usecase1(Pay)\n  usecase2(Use case)\n  User --> browse\n");
    const mixed = addUseCasePiece(MIXED, { kind: "actor" });
    expect(mixed.source).toContain('bot("Robot") <<system>>\n  actor actor1(Actor)\n\n  %% what');
    expect(changed(MIXED, mixed.source)).toEqual([]);
    // Where there is neither its kind nor a relation, at the end; the blank line there stays the end.
    expect(addUseCasePiece("usecase-beta\n  a(A)\n", { kind: "actor" }).source).toBe(
      "usecase-beta\n  a(A)\n  actor actor1(Actor)\n",
    );
    expect(
      addUseCasePiece("usecase-beta\n  actor A\n  %% uses\n  A --> b", { kind: "usecase" }).source,
    ).toBe("usecase-beta\n  actor A\n  usecase1(Use case)\n  %% uses\n  A --> b");
    // In a boundary whose lines are indented deeper, so is the new one.
    expect(addUseCasePiece(MIXED, { kind: "usecase", parent: "Club" }).source).toContain(
      "      pay[Pay fee]\n      usecase1(Use case)\n  end",
    );
  });

  it("adds a note for the element it is added at", () => {
    const note = addUseCasePiece(SHOP, { kind: "note", label: 'Say "hi"', parent: "order" });
    expect(note.id).toBe("note1");
    expect(note.source).toBe(`${SHOP}\n  note for order "Say #quot;hi#quot;"`);
    expect(parseUseCaseDiagram(note.source).notes[0]).toMatchObject({
      target: "order",
      text: 'Say "hi"',
    });
    // The next note follows the last, and is the last.
    const second = addUseCasePiece(MIXED, { kind: "note", parent: "Guest" });
    expect(second.id).toBe("note2");
    expect(second.source).toContain(
      '  note for pay "only once"\n  note for Guest "Note"\n  style pay',
    );
    expect(changed(MIXED, second.source)).toEqual([]);
  });

  it("adds no note without an element, and writes it when it is connected to one", () => {
    // No element, a boundary, an element a note cannot name: the source stays as it is.
    for (const parent of [undefined, null, "shop", "nobody"]) {
      const pending = addUseCasePiece(SHOP, { kind: "note", label: "Lost", parent });
      expect(pending).toEqual({ source: SHOP, id: "note1" });
    }
    expect(addUseCasePiece(MIXED, { kind: "note", parent: "Log out" })).toEqual({
      source: MIXED,
      id: "note2",
    });
    // The id it comes back with is the note to be: connected to an element, it is written.
    for (const joined of [
      connectUseCase(SHOP, "note1", "manage"),
      connectUseCase(SHOP, "manage", "note1", "association"),
    ]) {
      expect(joined).toBe(`${SHOP}\n  note for manage "Note"`);
      expect(usecaseStructure.read(joined).nodes.at(-1)).toMatchObject({
        id: "note1",
        kind: "note",
      });
    }
    expect(renameUseCase(connectUseCase(SHOP, "note1", "User"), "note1", "VIP")).toBe(
      `${SHOP}\n  note for User "VIP"`,
    );
    // Only the next note is promised, and only to an element a note can name.
    expect(connectUseCase(SHOP, "note2", "manage")).toBe(SHOP);
    expect(connectUseCase(SHOP, "note1", "shop")).toBe(SHOP);
    expect(connectUseCase(SHOP, "note1", "note1")).toBe(SHOP);
    expect(connectUseCase(MIXED, "note2", "Log out")).toBe(MIXED);
    // A diagram without an element has nothing a note could be for.
    expect(addUseCasePiece("usecase-beta", { kind: "note" })).toEqual({
      source: "usecase-beta",
      id: "",
    });
    expect(addUseCasePiece('usecase-beta\n  "Log out"', { kind: "note" }).id).toBe("");
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
    expect(connectUseCase(SHOP, "Admin", "order", "undirected")).toBe(`${SHOP}\n  Admin -- order`);
    // A quoted name is its own id.
    expect(connectUseCase(MIXED, "Guest", "Log out")).toContain('\n  Guest --> "Log out"\n');
    // Boundaries and unknown ids take no relation, and there is no unknown kind of one.
    expect(connectUseCase(SHOP, "User", "shop")).toBe(SHOP);
    expect(connectUseCase(SHOP, "User", "nobody")).toBe(SHOP);
    expect(connectUseCase(SHOP, "User", "order", "wavy")).toBe(SHOP);
  });

  it("connects only what UML relates", () => {
    const pairs: [string, string, string[]][] = [
      ["User", "order", ["association", "undirected"]],
      ["order", "User", ["association", "undirected"]],
      ["order", "browse", ["include", "extend", "generalization"]],
      ["Admin", "User", ["generalization"]],
    ];
    for (const [from, to, kinds] of pairs)
      for (const { kind } of usecaseStructure.links) {
        const joined = connectUseCase(SHOP, from, to, kind);
        if (!kinds.includes(kind)) expect(joined, `${from} ${kind} ${to}`).toBe(SHOP);
        else
          expect(usecaseStructure.read(joined).edges.at(-1), `${from} ${kind} ${to}`).toMatchObject(
            { id: "r4", source: from, target: to, kind },
          );
      }
    // Without a kind it is the one the two usually have.
    expect(connectUseCase(SHOP, "order", "User")).toBe(`${SHOP}\n  order --> User`);
    expect(connectUseCase(SHOP, "order", "browse")).toBe(`${SHOP}\n  order ..> : include browse`);
    expect(connectUseCase(SHOP, "Admin", "User")).toBe(`${SHOP}\n  Admin --|> User`);
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
    // An empty name leaves the id as the name, and so does the id itself.
    expect(renameUseCase(SHOP, "browse", " ")).toContain("    browse\n");
    expect(renameUseCase(SHOP, "shop", "")).toContain("  systemBoundary shop\n");
    expect(renameUseCase(actor, "User", "User")).toBe(SHOP);
    expect(renameUseCase(SHOP, "User", " User ")).toBe(SHOP);
    expect(renameUseCase(SHOP, "browse", "browse")).toContain("    browse\n");
    expect(renameUseCase(SHOP, "shop", "shop")).toContain("  systemBoundary shop\n");
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
    // Both angle brackets are written as codes, whatever stands between them; a line break stays.
    expect(renameUseCase(SHOP, "User", 'Käufer "VIP" (web) [x] <T>')).toContain(
      '  actor User("Käufer #quot;VIP#quot; (web) [x] #lt;T#gt;")\n',
    );
    expect(renameUseCase(SHOP, "browse", "a < b > c\n<br>d")).toContain(
      "    browse(a #lt; b #gt; c<br><br>d)\n",
    );
    expect(renameUseCase(MIXED, "note1", "x <y> z")).toContain('  note for pay "x #lt;y#gt; z"\n');
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
    const extend = relinkUseCase(MIXED, "r4", "extend");
    expect(extend).toContain("  enter ..> : extend pay\n");
    expect(changed(MIXED, extend)).toEqual(["  enter ..> : include pay"]);
    expect(relinkUseCase(MIXED, "r4", "generalization")).toContain("  enter --|> pay\n");
    expect(relinkUseCase(MIXED, "r5", "include")).toContain('  "Log out" ..> : include enter\n');
    expect(relinkUseCase(MIXED, "r1", "undirected")).toContain("  actor Owner -- pay\n");
    expect(relinkUseCase(MIXED, "r6", "undirected")).toContain("  bot -- late(Remind)\n");
    // With a mark at its end it is an association already.
    expect(relinkUseCase(MIXED, "r6", "association")).toBe(MIXED);
    // An arrow that points back is written from its source, so the relation keeps its ends.
    const back = relinkUseCase(MIXED, "r3", "undirected");
    expect(back).toContain("  Member -- enter\n");
    expect(relations(back)[2]).toBe("Member>enter:association");
    const declared = "usecase-beta\n  actor A, B <-- c(See)";
    expect(relinkUseCase(declared, "r1", "undirected")).toBe(
      "usecase-beta\n  actor A, B\n  c(See) -- A",
    );
    // What UML does not have between the two is not written.
    expect(relinkUseCase(MIXED, "r2", "include")).toBe(MIXED);
    expect(relinkUseCase(MIXED, "r1", "generalization")).toBe(MIXED);
    expect(relinkUseCase(MIXED, "r4", "association")).toBe(MIXED);
    expect(relinkUseCase(MIXED, "r5", "undirected")).toBe(MIXED);
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
    // A piece is joined only to what it has a relation with: never two actors or two use cases.
    expect(pieces.map((piece) => piece.joinsTo)).toEqual([
      ["actor"],
      ["usecase"],
      undefined,
      ["usecase", "actor"],
    ]);
    expect(links.map((link) => link.kind)).toEqual([
      "association",
      "undirected",
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
    const plain = usecaseStructure.relink(joined, "r4", "undirected");
    expect(usecaseStructure.read(plain).edges.at(-1)).toMatchObject({ kind: "undirected" });
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
      const added = usecaseStructure.add(MIXED, {
        kind: piece.kind,
        label: "New",
        parent: piece.kind === "note" ? "enter" : "Club",
      });
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
        // A relation becomes every kind UML has between its two elements, and no other.
        const [from, to] = [edge.source, edge.target].map(
            (id) => nodes.find((node) => node.id === id)!.kind,
          ),
          fits = (kind: string) =>
            kind === "include" || kind === "extend"
              ? from === "usecase" && to === "usecase"
              : kind === "generalization"
                ? from === to
                : from !== to;
        for (const link of links) {
          const relinked = usecaseStructure.relink(source, edge.id, link.kind);
          if (!fits(link.kind) && link.kind !== edge.kind) expect(relinked).toBe(source);
          else
            expect(
              usecaseStructure.read(relinked).edges.find((item) => item.id === edge.id),
              `${name}: ${edge.id} ${link.kind}`,
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

  /** A join without its line. */
  const unlined = ({ line: _line, ...rest }: UseCaseEdge) => rest;

  const FLYER = USECASE_EXAMPLES.find(([name]) => name.includes("TAM flyer"))![1];

  it("reads an association without an arrow as a kind of its own, and keeps it one", () => {
    const edges = usecaseStructure.read(FLYER).edges;
    expect(edges.map((edge) => edge.kind)).toEqual([
      "undirected",
      "undirected",
      "undirected",
      "association",
      "association",
      "undirected",
    ]);
    // There and back again: the line is plain as before.
    const directed = relinkUseCase(FLYER, "r6", "association");
    expect(changed(FLYER, directed)).toEqual(["  process -- svc"]);
    expect(directed).toContain("  process --> svc");
    expect(relinkUseCase(directed, "r6", "undirected")).toBe(FLYER);
    // The text of an association stays when its arrow goes or comes.
    const plain = relinkUseCase(MIXED, "r2", "undirected");
    expect(plain).toContain("  Guest -- asks -- enter\n");
    expect(usecaseStructure.read(plain).edges[1]).toMatchObject({
      kind: "undirected",
      label: "asks",
    });
    expect(relinkUseCase(plain, "r2", "association")).toBe(MIXED);
    expect(labelUseCaseRelation(plain, "r2", "begs")).toContain("  Guest -- begs -- enter\n");
    expect(labelUseCaseRelation(plain, "r2", "")).toContain("  Guest -- enter\n");
    // A mark at an end makes it an association.
    expect(usecaseStructure.read(MIXED).edges.map((edge) => edge.kind)).toEqual([
      "association",
      "association",
      "association",
      "include",
      "generalization",
      "association",
    ]);
  });

  it("marks the joins whose label is not to edit", () => {
    const edges: UseCaseEdge[] = usecaseStructure.read(MIXED).edges;
    expect(edges.map((edge) => edge.fixedLabel ?? false)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
    for (const edge of edges)
      if (edge.fixedLabel) expect(usecaseStructure.label(MIXED, edge.id, "text")).toBe(MIXED);
      else expect(usecaseStructure.label(MIXED, edge.id, "text")).not.toBe(MIXED);
  });

  it("gives a new part its first name as its id", async () => {
    const { retitle } = usecaseStructure;
    const added = usecaseStructure.add(SHOP, { kind: "usecase", parent: "shop" }),
      joined = usecaseStructure.connect(added.source, "Admin", added.id),
      named = retitle!(joined, added.id, "Archive Item");
    expect(named.id).toBe("archiveItem");
    expect(named.source).toBe(
      `${SHOP.replace("  end\n", "    archiveItem(Archive Item)\n  end\n")}\n  Admin --> archiveItem`,
    );
    await inScene(named.source);
    // One word is id and name at once.
    const actor = usecaseStructure.add(SHOP, { kind: "actor" });
    expect(retitle!(actor.source, actor.id, "Clerk")).toEqual({
      source: SHOP.replace("  actor Admin\n", "  actor Admin\n  actor Clerk\n"),
      id: "Clerk",
    });
    expect(retitle!(added.source, added.id, " pay ").source).toContain("    pay\n  end\n");
    expect(retitle!(added.source, added.id, "Pay!").source).toContain("    Pay(Pay!)\n  end\n");
    expect(retitle!(added.source, added.id, "CRM sync-job").source).toContain(
      "    CRMSyncJob(CRM sync-job)\n",
    );
    const boundary = usecaseStructure.add(SHOP, { kind: "boundary" });
    expect(retitle!(boundary.source, boundary.id, "Core Banking")).toMatchObject({
      id: "coreBanking",
    });
    expect(retitle!(boundary.source, boundary.id, "Core Banking").source).toContain(
      "  systemBoundary coreBanking[Core Banking]\n  end\n",
    );
    expect(retitle!(boundary.source, boundary.id, "Bank").source).toContain(
      "  systemBoundary Bank\n  end\n",
    );
    // A name that is taken, is a word of the syntax or has no word for an id is the label.
    expect(retitle!(actor.source, actor.id, "User")).toEqual({
      source: actor.source.replace("actor1(Actor)", "actor1(User)"),
      id: "actor1",
    });
    expect(retitle!(actor.source, actor.id, "shop").id).toBe("actor1");
    expect(retitle!(added.source, added.id, "end")).toEqual({
      source: added.source.replace("usecase1(Use case)", "usecase1(end)"),
      id: "usecase1",
    });
    expect(retitle!(actor.source, actor.id, "店員 Müller")).toEqual({
      source: actor.source.replace("actor1(Actor)", "actor1(店員 Müller)"),
      id: "actor1",
    });
    expect(retitle!(actor.source, actor.id, "?!")).toMatchObject({ id: "actor1" });
    // A note has no id to give: it gets its text.
    expect(retitle!(MIXED, "note1", "Twice")).toEqual({
      source: MIXED.replace("only once", "Twice"),
      id: "note1",
    });
    expect(retitle!(SHOP, "nobody", "Name")).toEqual({ source: SHOP, id: "nobody" });
    for (const [name, source] of USECASE_EXAMPLES)
      for (const piece of pieces.filter((piece) => piece.kind !== "note")) {
        const fresh = usecaseStructure.add(source, { kind: piece.kind }),
          titled = retitle!(fresh.source, fresh.id, "Brand New Thing");
        expect(titled.id, name).toBe("brandNewThing");
        expect(
          usecaseStructure.read(titled.source).nodes.find((node) => node.id === titled.id),
        ).toMatchObject({ label: "Brand New Thing", kind: piece.kind });
        expect(changed(source, titled.source), name).toEqual([]);
      }
  });

  it("renames an id wherever the source names it", async () => {
    const order = renameUsecaseId(SHOP, "order", "checkout");
    expect(changed(SHOP, order)).toEqual(["    order(Place Order)", "  User --> order"]);
    expect(order).toContain("    checkout(Place Order)\n");
    expect(order).toContain("  User --> checkout\n");
    const fee = renameUsecaseId(MIXED, "pay", "fee");
    expect(changed(MIXED, fee)).toEqual([
      "      pay[Pay fee]",
      "  actor Owner --> pay",
      "  enter ..> : include pay",
      '  note for pay "only once"',
      "  style pay fill:#eee",
    ]);
    expect(fee).toContain(
      '  enter ..> : include fee\n  "Log out" --|> enter\n  bot --o late(Remind)\n  note for fee "only once"\n  style fee fill:#eee\n',
    );
    expect(relations(fee)).toEqual(relations(MIXED).map((text) => text.replace("pay", "fee")));
    await inScene(fee);
    // In a list of actors, and in a list of styled elements.
    expect(renameUsecaseId(MIXED, "Member", "Patron")).toContain(
      '  actor Guest, Patron("Club member") <<human>>, bot("Robot") <<system>>\n',
    );
    expect(renameUsecaseId(MIXED, "Member", "Patron")).toContain("  enter <-- Patron\n");
    const classed = "usecase-beta\n  a(A)\n  ab(B)\n  classDef hot fill:#f00\n  class a, ab hot";
    expect(renameUsecaseId(classed, "a", "x")).toBe(
      "usecase-beta\n  x(A)\n  ab(B)\n  classDef hot fill:#f00\n  class x, ab hot",
    );
    // An element without a label is shown under its id; a quoted name stays the name.
    const user = renameUsecaseId(SHOP, "User", "Customer");
    expect(user).toContain("  actor Customer\n");
    expect(relations(user).slice(0, 2)).toEqual([
      "Customer>browse:association",
      "Customer>order:association",
    ]);
    const quoted = renameUsecaseId(`${MIXED}  Guest --> "Log out"\n`, "Log out", "logOut");
    expect(quoted).toContain("  logOut(Log out) --|> enter\n");
    expect(quoted).toContain("  Guest --> logOut\n");
    expect(element(quoted, "logOut")!.label).toBe("Log out");
    const club = renameUsecaseId(MIXED, "Club", "club");
    expect(club).toContain("  systemBoundary club[Club]\n");
    expect(element(club, "enter")!.boundary).toBe("club");
    expect(renameUsecaseId(SHOP, "shop", "store")).toContain("  systemBoundary store[Web Shop]\n");
    // An id that is taken, is no id or is a word of the syntax is refused.
    for (const name of ["browse", "shop", "User", "order", "two words", "", "a-b", "end", "actor"])
      expect(renameUsecaseId(SHOP, "order", name), name).toBe(SHOP);
    expect(renameUsecaseId(MIXED, "pay", "note1")).toBe(MIXED);
    expect(renameUsecaseId(SHOP, "nobody", "somebody")).toBe(SHOP);
    expect(renameUsecaseId(MIXED, "note1", "remark")).toBe(MIXED);
    for (const [name, source] of USECASE_EXAMPLES) {
      const { nodes, edges } = usecaseStructure.read(source);
      for (const node of nodes.filter((node) => node.kind !== "note")) {
        const renamed = renameUsecaseId(source, node.id, "renamed9"),
          swap = (id: string | null) => (id === node.id ? "renamed9" : id),
          now = usecaseStructure.read(renamed);
        expect(now.nodes.map((other) => other.id).toSorted(), `${name}: ${node.id}`).toEqual(
          nodes.map((other) => swap(other.id)).toSorted(),
        );
        expect(now.nodes.find((other) => other.id === "renamed9")).toMatchObject({
          kind: node.kind,
          parent: node.parent,
          label: node.label === node.id ? "renamed9" : node.label,
        });
        expect(now.edges).toEqual(
          edges.map((edge) => ({
            ...edge,
            source: swap(edge.source),
            target: swap(edge.target),
          })),
        );
        expect(now.nodes.filter((other) => other.parent === "renamed9")).toHaveLength(
          nodes.filter((other) => other.parent === node.id).length,
        );
      }
      await inScene(renameUsecaseId(source, nodes[0].id, "renamed9"));
    }
  });

  it("turns a relation round", () => {
    const first = reverseUsecaseRelation(SHOP, "r1");
    expect(changed(SHOP, first)).toEqual(["  User --> browse"]);
    expect(first).toContain("  browse --> User\n");
    expect(reverseUsecaseRelation(first, "r1")).toBe(SHOP);
    // A line that declares keeps its declaration; text and marks stay.
    expect(reverseUsecaseRelation(MIXED, "r1")).toContain("  actor Owner\n  pay --> Owner\n");
    expect(reverseUsecaseRelation(MIXED, "r2")).toContain("  enter -- asks --> Guest\n");
    expect(reverseUsecaseRelation(MIXED, "r3")).toContain("  enter --> Member\n");
    expect(reverseUsecaseRelation(MIXED, "r4")).toContain("  pay ..> : include enter\n");
    expect(reverseUsecaseRelation(MIXED, "r5")).toContain('  enter --|> "Log out"\n');
    expect(reverseUsecaseRelation(MIXED, "r6")).toContain("  late(Remind) --o bot\n");
    expect(reverseUsecaseRelation(MIXED, "r9")).toBe(MIXED);
    for (const [name, source] of [["mixed", MIXED], ...USECASE_EXAMPLES]) {
      const { nodes, edges } = usecaseStructure.read(source);
      for (const edge of edges) {
        const now = usecaseStructure.read(reverseUsecaseRelation(source, edge.id));
        expect(now.edges.map(unlined), `${name}: ${edge.id}`).toEqual(
          edges
            .map(unlined)
            .map((rest) =>
              rest.id === edge.id ? { ...rest, source: rest.target, target: rest.source } : rest,
            ),
        );
        expect(
          now.nodes
            .map((node) => `${node.id}:${node.kind}:${node.parent}:${node.label}`)
            .toSorted(),
        ).toEqual(
          nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.label}`).toSorted(),
        );
      }
    }
  });

  it("copies an actor or a use case without its relations", async () => {
    const browse = duplicateUsecasePart(SHOP, "browse");
    expect(browse.id).toBe("browse2");
    expect(browse.source).toBe(
      SHOP.replace("(Browse Products)\n", "(Browse Products)\n    browse2(Browse Products)\n"),
    );
    expect(element(browse.source, "browse2")).toMatchObject({ boundary: "shop", kind: "usecase" });
    expect(duplicateUsecasePart(browse.source, "browse").id).toBe("browse3");
    expect(duplicateUsecasePart(SHOP, "User")).toEqual({
      source: SHOP.replace("  actor User\n", "  actor User\n  actor User2\n"),
      id: "User2",
    });
    // Label, shape and stereotype come along.
    const bot = duplicateUsecasePart(MIXED, "bot");
    expect(bot.source).toContain("<<system>>\n  actor bot2(Robot) <<system>>\n");
    expect(element(bot.source, "bot2")).toMatchObject({
      kind: "actor",
      shape: "box",
      label: "Robot",
      stereotype: "system",
      boundary: null,
    });
    const pay = duplicateUsecasePart(MIXED, "pay");
    expect(pay.source).toContain("      pay[Pay fee]\n      pay2[Pay fee]\n  end\n");
    expect(element(pay.source, "pay2")).toMatchObject({ shape: "rect", boundary: "Club" });
    // One that a relation's line declares stands where its kind does.
    const late = duplicateUsecasePart(MIXED, "late");
    expect(late.source).toContain("  end\n  late2(Remind)\n  actor Owner --> pay\n");
    const quoted = duplicateUsecasePart(MIXED, "Log out");
    expect(quoted.id).toBe("logOut2");
    expect(element(quoted.source, "logOut2")!.label).toBe("Log out");
    for (const copy of [browse, bot, pay, late, quoted]) {
      expect(relations(copy.source)).toEqual(relations(copy === browse ? SHOP : MIXED));
      await inScene(copy.source);
    }
    // A boundary and a note are no elements to copy.
    expect(duplicateUsecasePart(SHOP, "shop")).toEqual({ source: SHOP, id: "" });
    expect(duplicateUsecasePart(MIXED, "note1")).toEqual({ source: MIXED, id: "" });
    for (const [name, source] of USECASE_EXAMPLES) {
      const { nodes, edges } = usecaseStructure.read(source);
      for (const node of nodes.filter((node) => node.kind === "actor" || node.kind === "usecase")) {
        const copy = duplicateUsecasePart(source, node.id),
          now = usecaseStructure.read(copy.source);
        expect(
          now.nodes.find((other) => other.id === copy.id),
          `${name}: ${node.id}`,
        ).toMatchObject({
          kind: node.kind,
          parent: node.parent,
          label: node.label === node.id ? copy.id : node.label,
        });
        expect(now.nodes).toHaveLength(nodes.length + 1);
        expect(now.edges.map(unlined)).toEqual(edges.map(unlined));
        expect(changed(source, copy.source)).toEqual([]);
      }
    }
  });

  it("moves a use case into a boundary and out of it", async () => {
    const out = moveUsecaseInto(SHOP, "order", null);
    expect(out).toBe(
      SHOP.replace("    order(Place Order)\n", "").replace(
        "  User --> browse\n",
        "  order(Place Order)\n  User --> browse\n",
      ),
    );
    expect(element(out, "order")).toMatchObject({ boundary: null, label: "Place Order" });
    const back = moveUsecaseInto(out, "order", "shop");
    expect(back).toContain("    manage(Manage Catalog)\n    order(Place Order)\n  end\n");
    expect(element(back, "order")!.boundary).toBe("shop");
    expect(relations(back)).toEqual(relations(SHOP));
    // From one boundary into another.
    const two = USECASE_EXAMPLES.find(([name]) => name.includes("two systems"))![1],
      moved = moveUsecaseInto(two, "book", "clinic");
    expect(changed(two, moved)).toEqual([]);
    expect(moved).toContain("    order(Order test)\n    book(Book appointment)\n  end\n");
    expect(moved).toContain("  systemBoundary portal[Patient portal]\n    results(View results)\n");
    expect(element(moved, "book")!.boundary).toBe("clinic");
    await inScene(moved);
    // A use case that relations only mention, or that one of them gives its label, is declared there.
    const bare = "usecase-beta\n  actor A\n  systemBoundary s\n    x(X)\n  end\n  A --> y";
    expect(moveUsecaseInto(bare, "y", "s")).toBe(
      "usecase-beta\n  actor A\n  systemBoundary s\n    x(X)\n    y\n  end\n  A --> y",
    );
    const late = moveUsecaseInto(MIXED, "late", "Club");
    expect(late).toContain("      pay[Pay fee]\n      late\n  end\n");
    expect(element(late, "late")).toMatchObject({ boundary: "Club", label: "Remind" });
    expect(moveUsecaseInto(late, "late", null)).toBe(MIXED);
    await inScene(late);
    // Out of a boundary, a use case that a relation names needs no line of its own.
    expect(moveUsecaseInto(moveUsecaseInto(bare, "y", "s"), "y", null)).toBe(bare);
    // Actors stand outside; where it is already, an unknown boundary, an unknown element: nothing changes.
    expect(moveUsecaseInto(SHOP, "User", "shop")).toBe(SHOP);
    expect(moveUsecaseInto(SHOP, "order", "shop")).toBe(SHOP);
    expect(moveUsecaseInto(out, "order", null)).toBe(out);
    expect(moveUsecaseInto(SHOP, "order", "bank")).toBe(SHOP);
    expect(moveUsecaseInto(SHOP, "nobody", "shop")).toBe(SHOP);
    for (const [name, source] of USECASE_EXAMPLES) {
      const { nodes, edges } = usecaseStructure.read(source),
        groups = [null, ...nodes.filter((node) => node.group).map((node) => node.id)];
      for (const node of nodes.filter((node) => node.kind === "usecase"))
        for (const group of groups) {
          const result = moveUsecaseInto(source, node.id, group),
            now = usecaseStructure.read(result);
          expect(
            now.nodes.find((other) => other.id === node.id),
            `${name}: ${node.id}`,
          ).toMatchObject({ parent: group, label: node.label, kind: node.kind });
          expect(now.nodes).toHaveLength(nodes.length);
          expect(now.edges.map(unlined)).toEqual(edges.map(unlined));
        }
    }
  });

  it("removes a boundary and keeps what it holds", async () => {
    expect(ungroupUsecaseBoundary(SHOP, "shop")).toBe(`usecase-beta
  direction LR
  actor User
  actor Admin
  browse(Browse Products)
  order(Place Order)
  manage(Manage Catalog)
  User --> browse
  User --> order
  Admin --> manage`);
    const club = ungroupUsecaseBoundary(MIXED, "Club");
    expect(club).toContain(
      "  %% what they do\n  enter(Enter)\n  %% inside\n  pay[Pay fee]\n  actor Owner --> pay\n",
    );
    expect(relations(club)).toEqual(relations(MIXED));
    expect(ungroupUsecaseBoundary(SHOP, "order")).toBe(SHOP);
    expect(ungroupUsecaseBoundary(SHOP, "bank")).toBe(SHOP);
    for (const [name, source] of USECASE_EXAMPLES) {
      const { nodes, edges } = usecaseStructure.read(source);
      for (const group of nodes.filter((node) => node.group)) {
        const open = ungroupUsecaseBoundary(source, group.id),
          now = usecaseStructure.read(open);
        expect(now.nodes.map((node) => `${node.id}:${node.parent}`).toSorted(), name).toEqual(
          nodes
            .filter((node) => node.id !== group.id)
            .map((node) => `${node.id}:${node.parent === group.id ? null : node.parent}`)
            .toSorted(),
        );
        expect(now.edges.map(unlined)).toEqual(edges.map(unlined));
        await inScene(open);
      }
    }
  });
});

describe("what else a canvas does with a use case diagram", () => {
  const { read, add, retitle } = usecaseStructure;
  const drawn = async (source: string, hint: string) => {
    const scene = await parseUml(source).layout(arialMeasure),
      shapes = new Set(scene.shapes.map((shape) => shape.id)),
      wires = new Set(scene.wires.map((wire) => wire.edge));
    for (const node of read(source).nodes)
      expect(shapes.has(node.id), `${hint} ${node.id}`).toBe(true);
    for (const edge of read(source).edges)
      expect(wires.has(edge.id), `${hint} ${edge.id}`).toBe(true);
  };
  /** The lines of `after` that `before` does not have. */
  const added = (before: string, after: string) => changed(after, before);

  it("says why two parts are not joined", () => {
    expect(whyNotUsecase(SHOP, "User", "browse", "generalization")).toBe(
      "A generalization joins two actors or two use cases.",
    );
    expect(whyNotUsecase(SHOP, "User", "browse", "include")).toBe("«include» joins two use cases.");
    expect(whyNotUsecase(SHOP, "User", "Admin", "extend")).toBe("«extend» joins two use cases.");
    expect(whyNotUsecase(SHOP, "User", "Admin", "association")).toBe(
      "An association joins an actor and a use case.",
    );
    expect(whyNotUsecase(SHOP, "browse", "order", "undirected")).toBe(
      "An association joins an actor and a use case.",
    );
    expect(whyNotUsecase(SHOP, "User", "shop", "association")).toMatch(/system boundary/i);
    expect(whyNotUsecase(SHOP, "User", "nothing")).toMatch(/actors and use cases/);
    expect(whyNotUsecase(SHOP, "User", "browse", "nonsense")).toMatch(/kind/);
    expect(whyNotUsecase(MIXED, "note1", "note2")).toMatch(/another note/);
    expect(whyNotUsecase(MIXED, "note1", "Club")).toMatch(/note is for/);
    expect(whyNotUsecase(MIXED, "note1", "Log out")).toMatch(/quoted name/);
    for (const [from, to, kind] of [
      ["User", "browse", undefined],
      ["User", "browse", "association"],
      ["browse", "User", "undirected"],
      ["browse", "order", "include"],
      ["order", "browse", "extend"],
      ["User", "Admin", "generalization"],
      ["browse", "order", "generalization"],
      ["User", "Admin", undefined],
      ["note1", "User", undefined],
    ] as const)
      expect(whyNotUsecase(SHOP, from, to, kind), `${from} ${to} ${kind}`).toBeUndefined();
    expect(whyNotUsecase(MIXED, "note1", "Guest")).toBeUndefined();
    // A reason exactly where nothing is written.
    for (const [name, source] of [["shop", SHOP], ["mixed", MIXED], ...USECASE_EXAMPLES]) {
      const all = [...read(source).nodes.map((node) => node.id), "nothing"].slice(0, 10);
      for (const from of all)
        for (const to of all)
          for (const link of [undefined, ...usecaseStructure.links.map((item) => item.kind)]) {
            const why = whyNotUsecase(source, from, to, link),
              written = connectUseCase(source, from, to, link) !== source;
            // A note that hangs on the element already is written the same again.
            if (!written && why === undefined)
              expect(
                [from, to].some((id) => /^note\d+$/.test(id)),
                `${name} ${from} ${to} ${link}`,
              ).toBe(true);
            else expect(why === undefined, `${name} ${from} ${to} ${link}`).toBe(written);
          }
    }
  });

  it("says which relation it wrote", () => {
    expect(joinUseCase(SHOP, "Admin", "browse")).toEqual({
      source: `${SHOP}\n  Admin --> browse`,
      edge: "r4",
    });
    expect(joinUseCase(SHOP, "order", "browse", "include")).toEqual({
      source: `${SHOP}\n  order ..> : include browse`,
      edge: "r4",
    });
    expect(joinUseCase(SHOP, "User", "browse", "generalization")).toEqual({
      source: SHOP,
      edge: "",
    });
    // A note has no join of its own.
    const note = joinUseCase(SHOP, "note1", "browse");
    expect(note.edge).toBe("");
    expect(added(SHOP, note.source)).toEqual(['  note for browse "Note"']);
  });

  it("adds a piece at a part and says what it wrote", async () => {
    // A use case at an actor, an actor at a use case: joined, from the actor.
    const use = attachUsecase(SHOP, { kind: "usecase", label: "Pay" }, "User");
    expect(use).toMatchObject({ id: "usecase1", edge: "r4" });
    expect(added(SHOP, use.source)).toEqual(["  usecase1(Pay)", "  User --> usecase1"]);
    const actor = attachUsecase(SHOP, { kind: "actor", label: "Clerk" }, "manage");
    expect(actor).toMatchObject({ id: "actor1", edge: "r4" });
    expect(added(SHOP, actor.source)).toEqual(["  actor actor1(Clerk)", "  actor1 --> manage"]);
    // A use case at a use case stands in its boundary, joined only with a kind of relation.
    const beside = attachUsecase(SHOP, { kind: "usecase" }, "order");
    expect(beside).toEqual({ ...add(SHOP, { kind: "usecase", parent: "shop" }), edge: "" });
    const included = attachUsecase(SHOP, { kind: "usecase", label: "Pay" }, "order", "include");
    expect(added(SHOP, included.source)).toEqual([
      "    usecase1(Pay)",
      "  order ..> : include usecase1",
    ]);
    expect(read(included.source).edges.find((edge) => edge.id === included.edge)).toMatchObject({
      source: "order",
      target: "usecase1",
      kind: "include",
    });
    // A kind UML does not have between the two gives way to the usual one.
    const usual = attachUsecase(SHOP, { kind: "usecase" }, "User", "include");
    expect(read(usual.source).edges.find((edge) => edge.id === usual.edge)).toMatchObject({
      source: "User",
      target: "usecase1",
      kind: "association",
    });
    expect(
      read(attachUsecase(SHOP, { kind: "actor" }, "User", "generalization").source).edges.at(-1),
    ).toMatchObject({
      source: "User",
      target: "actor1",
      kind: "generalization",
    });
    // Into a boundary; a note for its element; a boundary alone; a note at a boundary is nothing.
    expect(attachUsecase(SHOP, { kind: "usecase" }, "shop", "include")).toEqual({
      ...add(SHOP, { kind: "usecase", parent: "shop" }),
      edge: "",
    });
    expect(attachUsecase(SHOP, { kind: "note", label: "slow" }, "browse")).toEqual({
      source: `${SHOP}\n  note for browse "slow"`,
      id: "note1",
      edge: "",
    });
    expect(attachUsecase(SHOP, { kind: "boundary" }, "browse")).toEqual({
      ...add(SHOP, { kind: "boundary" }),
      edge: "",
    });
    expect(attachUsecase(SHOP, { kind: "note" }, "shop")).toEqual({
      source: SHOP,
      id: "",
      edge: "",
    });
    expect(attachUsecase(SHOP, { kind: "note" }, "nothing")).toEqual({
      source: SHOP,
      id: "",
      edge: "",
    });
    for (const [name, source] of USECASE_EXAMPLES) {
      const nodes = read(source).nodes;
      for (const host of [
        nodes.find((node) => node.kind === "actor")!,
        nodes.find((node) => node.kind === "usecase")!,
      ])
        for (const piece of usecaseStructure.pieces) {
          const made = attachUsecase(
              source,
              { kind: piece.kind, label: "New one" },
              host.id,
              "association",
            ),
            hint = `${name} ${piece.kind} at ${host.id}`;
          if (!made.id) continue;
          const now = read(made.source);
          expect(
            now.nodes.find((node) => node.id === made.id),
            hint,
          ).toMatchObject({
            kind: piece.kind,
            label: "New one",
          });
          if (piece.kind === "usecase" || piece.kind === "actor") {
            const edge = now.edges.find((item) => item.id === made.edge)!;
            expect([edge.source, edge.target].toSorted(), hint).toEqual(
              [host.id, made.id].toSorted(),
            );
          } else expect(made.edge, hint).toBe("");
          expect(changed(source, made.source), hint).toEqual([]);
          await drawn(made.source, hint);
        }
    }
  });

  it("drops a label that says what the id says, and knows a made-up id", () => {
    const named = renameUseCase(SHOP, "User", "Customer");
    expect(named).toContain("  actor User(Customer)\n");
    expect(renameUsecaseId(named, "User", "Customer")).toContain("  actor Customer\n");
    expect(renameUsecaseId(SHOP, "browse", "Browse")).toContain("    Browse(Browse Products)\n");
    expect(renameUsecaseId(SHOP, "shop", "Web")).toContain("  systemBoundary Web[Web Shop]\n");
    // A box is one by the brackets of its label: they stay.
    const box = "usecase-beta\n  pay[Pay]\n  actor A --> pay";
    expect(renameUsecaseId(box, "pay", "Pay")).toBe("usecase-beta\n  Pay[Pay]\n  actor A --> Pay");

    for (const kind of ["usecase", "actor", "boundary"]) {
      const made = add(SHOP, { kind });
      expect(isGeneratedUsecaseId(made.source, made.id), kind).toBe(true);
      expect(
        isGeneratedUsecaseId(retitle!(made.source, made.id, "Fresh one").source, "freshOne"),
      ).toBe(false);
    }
    const copy = duplicateUsecasePart(SHOP, "browse");
    expect(copy.id).toBe("browse2");
    expect(isGeneratedUsecaseId(copy.source, "browse2")).toBe(true);
    expect(isGeneratedUsecaseId(copy.source, "browse")).toBe(false);
    // Its first name becomes its id.
    const search = retitle!(copy.source, copy.id, "Search catalog");
    expect(search.id).toBe("searchCatalog");
    expect(search.source).toContain("    searchCatalog(Search catalog)\n");
    expect(isGeneratedUsecaseId(search.source, search.id)).toBe(false);
    expect(isGeneratedUsecaseId(duplicateUsecasePart(SHOP, "User").source, "User2")).toBe(true);
    // One that only looks like a copy and shows another name is none.
    expect(isGeneratedUsecaseId("usecase-beta\n  pay(Pay)\n  pay2(Pay twice)", "pay2")).toBe(false);
    for (const id of ["nothing", "note1", "r1", "shop"])
      expect(isGeneratedUsecaseId(SHOP, id)).toBe(false);
    for (const [name, source] of [["mixed", MIXED], ...USECASE_EXAMPLES])
      for (const node of read(source).nodes) {
        expect(isGeneratedUsecaseId(source, node.id), `${name} ${node.id}`).toBe(false);
        const made = duplicateUsecasePart(source, node.id);
        if (made.id)
          expect(isGeneratedUsecaseId(made.source, made.id), `${name} ${node.id}`).toBe(true);
      }
  });

  it("says what a removal takes with it", () => {
    expect(usecaseRemovalSummary(SHOP, ["shop"])).toBe(
      "System boundary Web Shop with 3 use cases and 3 relations",
    );
    expect(usecaseRemovalSummary(SHOP, ["User"])).toBe("User with 2 relations");
    // What is named is not counted again: the relation `r1` goes beside the three.
    expect(usecaseRemovalSummary(SHOP, ["User", "browse", "r2"])).toBe(
      "User, Browse Products with 1 relation",
    );
    expect(usecaseRemovalSummary(SHOP, ["r1"])).toBe("1 relation");
    expect(usecaseRemovalSummary(MIXED, ["pay"])).toBe("Pay fee with 2 relations and 1 note");
    expect(usecaseRemovalSummary(MIXED, ["note1", "r1"])).toBe("1 relation and 1 note");
    expect(usecaseRemovalSummary(add(SHOP, { kind: "actor" }).source, ["actor1"])).toBe("Actor");
    expect(usecaseRemovalSummary(SHOP, ["nothing"])).toBe("");
    expect(usecaseRemovalSummary(SHOP, [])).toBe("");
    for (const [name, source] of [["mixed", MIXED], ...USECASE_EXAMPLES])
      for (const node of read(source).nodes)
        expect(usecaseRemovalSummary(source, [node.id]) === "", `${name} ${node.id}`).toBe(
          removeUseCase(source, [node.id]) === source,
        );
  });
});
