// What the Properties offer a UML diagram's parts and joins beyond their names: a class's stereotype, a state's
// description, a relation's multiplicities, an ER relationship's cardinalities, the kinds a join's list offers, a
// sequence message's reply and activation.
import assert from "node:assert/strict";
import { test } from "vitest";
import { arialMeasure, parseUml } from "../../src/index.ts";
import {
  cardinalities,
  doesOf,
  joinKinds,
  multiplicities,
  pieceName,
  shownId,
  stereotypeOf,
  withActivation,
  withCardinality,
  withDoes,
  withIdentifying,
  withMultiplicity,
  withReply,
  withStereotype,
} from "./diagram-props-uml.ts";
import { uml } from "./diagram-uml.ts";

const drawn = async (source: string) =>
  uml.modelOf(source, await parseUml(source).layout(arialMeasure), "Arial")!;

test("a class relation has a multiplicity at each end; a class its stereotype", async () => {
  const m = await drawn('classDiagram\n  class A\n  class B\n  A "1" --> "*" B : has\n');
  const [edge] = m.edges;
  assert.deepEqual(multiplicities(m, edge!.id), { from: "1", to: "*" });
  assert.match(withMultiplicity(m, edge!.id, "to", "0..1"), /A "1" --> "0..1" B : has/);
  assert.equal(stereotypeOf(m, "A"), "");
  assert.match(withStereotype(m, "A", "interface"), /<<interface>>/);
  assert.equal(cardinalities(m, edge!.id), undefined);
  assert.equal(joinKinds(m, edge!.id)?.value, edge!.kind);
});

test("an ER relationship has a cardinality at each end and identifies or not", async () => {
  const m = await drawn("erDiagram\n  A ||--o{ B : has\n");
  const [edge] = m.edges;
  assert.deepEqual(cardinalities(m, edge!.id), {
    from: "only-one",
    to: "zero-or-more",
    identifying: true,
  });
  assert.match(withCardinality(m, edge!.id, "to", "one-or-more"), /A \|\|--\|\{ B : has/);
  assert.match(withIdentifying(m, edge!.id, false), /A \|\|\.\.o\{ B : has/);
  assert.equal(multiplicities(m, edge!.id), undefined);
});

test("a state says what it does; ids show as the source writes them", async () => {
  const m = await drawn("stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n");
  assert.equal(doesOf(m, "Idle"), "");
  assert.match(withDoes(m, "Idle", "entry / wait"), /Idle : entry \/ wait/);
  assert.equal(shownId("ns:Shop"), "Shop");
  assert.equal(shownId("head:A"), "A");
});

test("a sequence message gets a reply after it and its activation turned on", async () => {
  const m = await drawn("sequenceDiagram\n  A->>B: ask\n");
  const [edge] = m.edges;
  assert.match(withReply(m, edge!.id), /A->>B: ask\n\s*B-->>A/);
  assert.match(withActivation(m, edge!.id), /A->>\+B: ask/);
  assert.equal(
    pieceName(m, "A"),
    m.structure.pieces.find((p) => p.kind === m.parts.get("A")?.kind)?.name,
  );
});
