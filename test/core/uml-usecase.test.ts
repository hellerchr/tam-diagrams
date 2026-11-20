// Use case diagrams: parsing (errors with their lines) and the source edits.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseUseCaseDiagram } from "../../src/uml-usecase.ts";
import * as edit from "../../src/uml-usecase-edit.ts";
import { UmlError } from "../../src/uml.ts";

const { usecaseStructure: structure } = edit;

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

/** The relations of a source as `source>target:kind:label`; parsing it is the check that it still reads. */
const relations = (source: string) =>
  parseUseCaseDiagram(source).relations.map(
    (item) => `${item.source}>${item.target}:${item.kind}${item.label ? `:${item.label}` : ""}`,
  );

const element = (source: string, id: string) => parseUseCaseDiagram(source).elements.get(id);

/** The lines of `before` that `after` no longer has. */
const lost = (before: string, after: string) => {
  const kept = new Set(after.split("\n"));
  return before.split("\n").filter((line) => !kept.has(line));
};

/** The UmlError parsing `source` throws. */
const parseError = (source: string): UmlError => {
  try {
    parseUseCaseDiagram(source);
  } catch (error) {
    assert.ok(error instanceof UmlError);
    return error;
  }
  return assert.fail(`parsed: ${source}`);
};

test("reads actors, machine actors, boundaries, use cases, relations and notes", () => {
  const diagram = parseUseCaseDiagram(`usecase-beta
  actor User, Admin
  actor svc("Billing") <<system>>
  systemBoundary shop[Shop]
    buy(Buy item)
    pay[Pay]
  end
  User --> buy
  buy ..> : include pay
  pay ..> : extend buy
  Admin --|> User
  svc -- invoice --> pay
  buy <-- Admin
  note for buy "main flow"`);
  assert.deepEqual(
    [...diagram.elements.values()].map((item) =>
      [item.id, item.kind, item.shape, item.boundary].join(" "),
    ),
    [
      "User actor figure ",
      "Admin actor figure ",
      "svc actor box ",
      "buy usecase ellipse shop",
      "pay usecase rect shop",
    ],
  );
  assert.deepEqual(relations(MIXED), [
    "Owner>pay:association",
    "Guest>enter:association:asks",
    "Member>enter:association",
    "enter>pay:include:«include»",
    "Log out>enter:generalization",
    "bot>late:association",
  ]);
  assert.deepEqual(
    diagram.relations.map(
      (item) => `${item.source}>${item.target}:${item.kind}:${item.label ?? ""}`,
    ),
    [
      "User>buy:association:",
      "buy>pay:include:«include»",
      "pay>buy:extend:«extend»",
      "Admin>User:generalization:",
      "svc>pay:association:invoice",
      "Admin>buy:association:",
    ],
  );
  assert.partialDeepStrictEqual(diagram.notes[0], { target: "buy", text: "main flow" });
});

test("reports errors with their lines, and leaves what it does not draw to Mermaid", () => {
  const cases: [string, number, RegExp][] = [
    [
      "usecase-beta\n  systemBoundary s[S]\n    a(A)",
      2,
      /System boundary `s` is missing its `end`/,
    ],
    ["usecase-beta\n  a(A) ==> b", 2, /Cannot read the relation `==> b`/],
    ["usecase-beta\n  end", 2, /Unmatched `end`/],
    ["usecase-beta\n  systemBoundary a\n  systemBoundary b", 3, /cannot be nested/],
    ["usecase-beta\n  systemBoundary s\n    a --> b\n  end", 3, /outside system boundaries/],
    ["usecase-beta\n  a(A)\n  actor a", 3, /already a use case/],
    ["usecase-beta\n  note for x hi", 2, /Unknown element `x`/],
    ["usecase-beta\n  %% level design\n  actor A", 0, /conceptual level/],
  ];
  for (const [source, line, message] of cases) {
    const error = parseError(source);
    assert.equal(error.line, line, source);
    assert.match(error.message, message);
  }
  assert.equal(parseError('usecase-beta\n  json {"a": 1}').unsupported, true);
});

test("reads parts with boundaries before what they hold, and joins with their kinds", () => {
  const { nodes, edges } = structure.read(MIXED);
  assert.deepEqual(
    nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}`),
    [
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
    ],
  );
  assert.deepEqual(
    edges.map((edge) => `${edge.kind}:${edge.fixedLabel ?? false}`),
    [
      "association:false",
      "association:false",
      "association:false",
      "include:true",
      "generalization:true",
      "association:false",
    ],
  );
  assert.deepEqual(
    structure
      .read("usecase-beta\n  actor A\n  A -- x\n  systemBoundary s\n    x(X)\n  end")
      .edges.map((edge) => edge.kind),
    ["undirected"],
  );
});

test("adds use cases, actors, boundaries and notes where their kind stands", () => {
  const useCase = edit.addUseCasePiece(SHOP, { kind: "usecase", label: "Pay" });
  assert.equal(useCase.id, "usecase1");
  assert.equal(
    useCase.source,
    SHOP.replace("  User --> browse\n", "  usecase1(Pay)\n  User --> browse\n"),
  );
  assert.ok(
    edit
      .addUseCasePiece(MIXED, { kind: "usecase", parent: "Club" })
      .source.includes("      pay[Pay fee]\n      usecase1(Use case)\n  end"),
  );
  const actor = edit.addUseCasePiece(SHOP, { kind: "actor", label: "Clerk", parent: "shop" });
  assert.equal(
    actor.source,
    SHOP.replace("  actor Admin\n", "  actor Admin\n  actor actor1(Clerk)\n"),
  );
  const boundary = edit.addUseCasePiece(SHOP, { kind: "boundary", label: "Bank" });
  assert.equal(
    boundary.source,
    SHOP.replace("  end\n", "  end\n  systemBoundary system1[Bank]\n  end\n"),
  );
  const note = edit.addUseCasePiece(SHOP, { kind: "note", label: 'Say "hi"', parent: "order" });
  assert.equal(note.source, `${SHOP}\n  note for order "Say #quot;hi#quot;"`);
  // Without an element the note waits: connected to one, it is written under the id promised.
  assert.deepEqual(edit.addUseCasePiece(SHOP, { kind: "note", parent: "shop" }), {
    source: SHOP,
    id: "note1",
  });
  assert.equal(edit.connectUseCase(SHOP, "note1", "manage"), `${SHOP}\n  note for manage "Note"`);
});

test("connects only what UML relates, with the usual kind by default", () => {
  assert.equal(edit.connectUseCase(SHOP, "Admin", "order"), `${SHOP}\n  Admin --> order`);
  assert.equal(
    edit.connectUseCase(SHOP, "order", "browse"),
    `${SHOP}\n  order ..> : include browse`,
  );
  assert.equal(edit.connectUseCase(SHOP, "Admin", "User"), `${SHOP}\n  Admin --|> User`);
  assert.equal(
    edit.connectUseCase(SHOP, "Admin", "order", "undirected"),
    `${SHOP}\n  Admin -- order`,
  );
  for (const [from, to, kind] of [
    ["User", "shop", undefined],
    ["User", "order", "include"],
    ["User", "Admin", "association"],
  ])
    assert.equal(edit.connectUseCase(SHOP, from!, to!, kind), SHOP, `${from} ${kind} ${to}`);
  // A note moves to the element it is connected to.
  assert.deepEqual(lost(MIXED, edit.connectUseCase(MIXED, "note1", "enter")), [
    '  note for pay "only once"',
  ]);
  assert.deepEqual(edit.joinUseCase(SHOP, "order", "browse", "include"), {
    source: `${SHOP}\n  order ..> : include browse`,
    edge: "r4",
  });
});

test("says why two parts are not joined, exactly where nothing is written", () => {
  assert.equal(
    edit.whyNotUsecase(SHOP, "User", "browse", "generalization"),
    "A generalization joins two actors or two use cases.",
  );
  assert.equal(
    edit.whyNotUsecase(SHOP, "User", "Admin", "association"),
    "An association joins an actor and a use case.",
  );
  assert.match(edit.whyNotUsecase(MIXED, "note1", "Log out") ?? "", /quoted name/);
  for (const [from, to, kind] of [
    ["User", "browse", undefined],
    ["browse", "order", "extend"],
    ["User", "shop", "association"],
    ["User", "browse", "nonsense"],
  ])
    assert.equal(
      edit.whyNotUsecase(SHOP, from!, to!, kind) === undefined,
      edit.connectUseCase(SHOP, from!, to!, kind) !== SHOP,
    );
});

test("renames by the label, wherever the element is named first, and writes special characters as codes", () => {
  assert.deepEqual(lost(SHOP, edit.renameUseCase(SHOP, "User", "Customer")), ["  actor User"]);
  assert.ok(
    edit
      .renameUseCase(MIXED, "Member", "Patron")
      .includes('  actor Guest, Member(Patron) <<human>>, bot("Robot") <<system>>\n'),
  );
  assert.ok(edit.renameUseCase(MIXED, "pay", "Pay up").includes("      pay[Pay up]\n"));
  assert.equal(
    edit.renameUseCase("usecase-beta\n  actor A\n  A --> b\n  b --> c", "b", "Bee"),
    "usecase-beta\n  actor A\n  A --> b(Bee)\n  b --> c",
  );
  assert.ok(edit.renameUseCase(MIXED, "Log out", "Sign off").includes('  "Sign off" --|> enter\n'));
  assert.equal(edit.renameUseCase(MIXED, "Log out", "enter"), MIXED);
  assert.ok(
    edit.renameUseCase(MIXED, "note1", "x <y> z").includes('  note for pay "x #lt;y#gt; z"\n'),
  );
  for (const name of ['Pay (now) "hi"', "Items [all] & more; #1", "x :: y @{ z } <<q>>"])
    for (const id of ["browse", "User"])
      assert.equal(
        structure.read(structure.rename(SHOP, id, name)).nodes.find((node) => node.id === id)
          ?.label,
        name,
        `${id}: ${name}`,
      );
});

test("labels associations, and relinks and turns relations round, keeping their ends", () => {
  assert.ok(
    edit.labelUseCaseRelation(SHOP, "r2", "places").includes("  User -- places --> order\n"),
  );
  assert.ok(
    edit.labelUseCaseRelation(MIXED, "r3", "joins").includes("  Member -- joins --> enter\n"),
  );
  assert.equal(edit.labelUseCaseRelation(MIXED, "r4", "x"), MIXED);
  assert.ok(
    edit
      .labelUseCaseRelation(SHOP, "r1", ">= 1 - 2")
      .includes("  User -- #gt;= 1 #45; 2 --> browse\n"),
  );
  assert.deepEqual(lost(MIXED, edit.relinkUseCase(MIXED, "r4", "extend")), [
    "  enter ..> : include pay",
  ]);
  assert.ok(edit.relinkUseCase(MIXED, "r1", "undirected").includes("  actor Owner -- pay\n"));
  assert.equal(
    edit.relinkUseCase("usecase-beta\n  actor A, B <-- c(See)", "r1", "undirected"),
    "usecase-beta\n  actor A, B\n  c(See) -- A",
  );
  const plain = edit.relinkUseCase(MIXED, "r2", "undirected");
  assert.equal(relations(plain)[1], "Guest>enter:association:asks");
  assert.equal(edit.relinkUseCase(plain, "r2", "association"), MIXED);
  assert.equal(edit.relinkUseCase(MIXED, "r2", "include"), MIXED);
  const first = edit.reverseUsecaseRelation(SHOP, "r1");
  assert.ok(first.includes("  browse --> User\n"));
  assert.equal(edit.reverseUsecaseRelation(first, "r1"), SHOP);
  assert.ok(edit.reverseUsecaseRelation(MIXED, "r1").includes("  actor Owner\n  pay --> Owner\n"));
});

test("removes elements with their relations and notes, relations without their elements, and boundaries", () => {
  assert.deepEqual(lost(SHOP, edit.removeUseCase(SHOP, ["order"])), [
    "    order(Place Order)",
    "  User --> order",
  ]);
  assert.ok(
    edit.removeUseCase(MIXED, ["Member"]).includes('  actor Guest, bot("Robot") <<system>>\n'),
  );
  const unpaid = edit.removeUseCase(MIXED, ["pay"]);
  assert.ok(unpaid.includes("  actor Owner\n"));
  assert.doesNotMatch(unpaid, /note for|style pay|include|Pay fee/);
  assert.ok(edit.removeUseCase(MIXED, ["r5"]).includes('  "Log out"\n'));
  const bare = "usecase-beta\n  a --> b\n  b --> c\n  a --> c";
  assert.equal(edit.removeUseCase(bare, ["r1", "r2", "r3"]), "usecase-beta\n  a\n  b\n  c");
  assert.equal(
    edit.removeUseCase(SHOP, ["shop"]),
    "usecase-beta\n  direction LR\n  actor User\n  actor Admin",
  );
  assert.equal(
    edit.usecaseRemovalSummary(SHOP, ["shop"]),
    "System boundary Web Shop with 3 use cases and 3 relations",
  );
  assert.equal(
    edit.usecaseRemovalSummary(SHOP, ["User", "browse", "r2"]),
    "User, Browse Products with 1 relation",
  );
  assert.equal(edit.usecaseRemovalSummary(MIXED, ["pay"]), "Pay fee with 2 relations and 1 note");
});

test("ungroups a boundary and moves a use case into one and out of it", () => {
  const club = edit.ungroupUsecaseBoundary(MIXED, "Club");
  assert.ok(
    club.includes(
      "  %% what they do\n  enter(Enter)\n  %% inside\n  pay[Pay fee]\n  actor Owner --> pay\n",
    ),
  );
  assert.deepEqual(relations(club), relations(MIXED));
  const out = edit.moveUsecaseInto(SHOP, "order", null);
  assert.equal(
    out,
    SHOP.replace("    order(Place Order)\n", "").replace(
      "  User --> browse\n",
      "  order(Place Order)\n  User --> browse\n",
    ),
  );
  assert.ok(
    edit
      .moveUsecaseInto(out, "order", "shop")
      .includes("    manage(Manage Catalog)\n    order(Place Order)\n  end\n"),
  );
  const late = edit.moveUsecaseInto(MIXED, "late", "Club");
  assert.ok(late.includes("      pay[Pay fee]\n      late\n  end\n"));
  assert.partialDeepStrictEqual(element(late, "late"), { boundary: "Club", label: "Remind" });
  assert.equal(edit.moveUsecaseInto(late, "late", null), MIXED);
  assert.equal(edit.moveUsecaseInto(SHOP, "User", "shop"), SHOP);
});

test("renames an id wherever the source names it", () => {
  const fee = edit.renameUsecaseId(MIXED, "pay", "fee");
  assert.deepEqual(lost(MIXED, fee), [
    "      pay[Pay fee]",
    "  actor Owner --> pay",
    "  enter ..> : include pay",
    '  note for pay "only once"',
    "  style pay fill:#eee",
  ]);
  assert.deepEqual(
    relations(fee),
    relations(MIXED).map((text) => text.replace("pay", "fee")),
  );
  assert.equal(
    edit.renameUsecaseId(
      "usecase-beta\n  a(A)\n  ab(B)\n  classDef hot fill:#f00\n  class a, ab hot",
      "a",
      "x",
    ),
    "usecase-beta\n  x(A)\n  ab(B)\n  classDef hot fill:#f00\n  class x, ab hot",
  );
  const quoted = edit.renameUsecaseId(MIXED, "Log out", "logOut");
  assert.ok(quoted.includes("  logOut(Log out) --|> enter\n"));
  // A label that says what the new id says goes.
  assert.ok(
    edit
      .renameUsecaseId(edit.renameUseCase(SHOP, "User", "Customer"), "User", "Customer")
      .includes("  actor Customer\n"),
  );
  for (const name of ["browse", "two words", "end"])
    assert.equal(edit.renameUsecaseId(SHOP, "order", name), SHOP, name);
  assert.equal(edit.renameUsecaseId(MIXED, "note1", "remark"), MIXED);
});

test("gives a new part its first name as id, and copies an element without its relations", () => {
  const retitle = (source: string, id: string, name: string) =>
    structure.retitle!(source, id, name);
  const added = structure.add(SHOP, { kind: "usecase", parent: "shop" });
  assert.ok(edit.isGeneratedUsecaseId(added.source, added.id));
  const named = retitle(
    structure.connect(added.source, "Admin", added.id),
    added.id,
    "Archive Item",
  );
  assert.equal(named.id, "archiveItem");
  assert.equal(
    named.source,
    `${SHOP.replace("  end\n", "    archiveItem(Archive Item)\n  end\n")}\n  Admin --> archiveItem`,
  );
  assert.ok(!edit.isGeneratedUsecaseId(named.source, named.id));
  assert.deepEqual(retitle(MIXED, "note1", "Twice"), {
    source: MIXED.replace("only once", "Twice"),
    id: "note1",
  });
  const bot = edit.duplicateUsecasePart(MIXED, "bot");
  assert.ok(bot.source.includes("<<system>>\n  actor bot2(Robot) <<system>>\n"));
  assert.partialDeepStrictEqual(element(bot.source, "bot2"), {
    kind: "actor",
    shape: "box",
    label: "Robot",
    stereotype: "system",
  });
  assert.deepEqual(relations(bot.source), relations(MIXED));
  assert.ok(
    edit.isGeneratedUsecaseId(bot.source, "bot2") && !edit.isGeneratedUsecaseId(bot.source, "bot"),
  );
  assert.deepEqual(edit.duplicateUsecasePart(SHOP, "shop"), { source: SHOP, id: "" });
  assert.ok(!edit.isGeneratedUsecaseId("usecase-beta\n  pay(Pay)\n  pay2(Pay twice)", "pay2"));
});

test("adds a piece at a part and says what it wrote", () => {
  const use = edit.attachUsecase(SHOP, { kind: "usecase", label: "Pay" }, "User");
  assert.deepEqual([use.id, use.edge], ["usecase1", "r4"]);
  assert.deepEqual(lost(use.source, SHOP), ["  usecase1(Pay)", "  User --> usecase1"]);
  const actor = edit.attachUsecase(SHOP, { kind: "actor", label: "Clerk" }, "manage");
  assert.deepEqual(lost(actor.source, SHOP), ["  actor actor1(Clerk)", "  actor1 --> manage"]);
  const included = edit.attachUsecase(SHOP, { kind: "usecase", label: "Pay" }, "order", "include");
  assert.deepEqual(lost(included.source, SHOP), [
    "    usecase1(Pay)",
    "  order ..> : include usecase1",
  ]);
  assert.deepEqual(edit.attachUsecase(SHOP, { kind: "note", label: "slow" }, "browse"), {
    source: `${SHOP}\n  note for browse "slow"`,
    id: "note1",
    edge: "",
  });
  assert.deepEqual(edit.attachUsecase(SHOP, { kind: "note" }, "shop"), {
    source: SHOP,
    id: "",
    edge: "",
  });
});
