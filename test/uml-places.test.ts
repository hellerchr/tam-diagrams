import { describe, expect, it } from "vitest";
import { parseUml } from "../src/index.ts";
import { classStructure } from "../src/uml-class-edit.ts";
import { stateStructure } from "../src/uml-state-edit.ts";
import {
  followPlaces,
  hasPlaces,
  prunePlaces,
  readPlaces,
  removePlaces,
  renamePlace,
  setPlaces,
} from "../src/uml-places.ts";

const SOURCE = `classDiagram
  class Order
  class Customer
  Customer --> Order`;

describe("places in a Mermaid source", () => {
  it("reads the place of each part from its comment line, wherever the line stands", () => {
    const source = `classDiagram
%% @Order 120,80
  class Order
  %%   @ns:billing   40 , -300
  class Customer
%% @Review#initial 10.5,10
%% a comment @ 1,2
%% @Order 130,90`;
    expect([...readPlaces(source)]).toEqual([
      ["Order", { x: 130, y: 90 }],
      ["ns:billing", { x: 40, y: -300 }],
      ["Review#initial", { x: 10.5, y: 10 }],
    ]);
    expect(hasPlaces(source)).toBe(true);
    expect(hasPlaces(SOURCE)).toBe(false);
    expect(readPlaces(SOURCE).size).toBe(0);
    // The lines are comments to every parser of the type.
    expect(parseUml(source).kind).toBe("class");
  });

  it("writes places as one block at the end and leaves every other line as it is", () => {
    const placed = setPlaces(SOURCE, { Order: { x: 120.4, y: 80 } });
    expect(placed).toBe(`${SOURCE}\n%% @Order 120,80\n`);
    const both = setPlaces(placed, new Map([["Customer", { x: -5, y: 7 }]]));
    expect(both).toBe(`${SOURCE}\n%% @Order 120,80\n%% @Customer -5,7\n`);
    // A place set again replaces its line where it stands in the block.
    expect(setPlaces(both, { Order: { x: 1, y: 2 } })).toBe(
      `${SOURCE}\n%% @Order 1,2\n%% @Customer -5,7\n`,
    );
    // Lines elsewhere come to the block at the end.
    const scattered = `classDiagram\n%% @Order 1,2\n  class Order\n  %% a note\n  class Customer\n`;
    expect(setPlaces(scattered, { Customer: { x: 3, y: 4 } })).toBe(
      `classDiagram\n  class Order\n  %% a note\n  class Customer\n%% @Order 1,2\n%% @Customer 3,4\n`,
    );
  });

  it("removes places: some, or all for the automatic layout", () => {
    const placed = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
    expect(removePlaces(placed, ["Order"])).toBe(`${SOURCE}\n%% @Customer 3,4\n`);
    expect(removePlaces(placed)).toBe(`${SOURCE}\n`);
    expect(removePlaces(SOURCE)).toBe(SOURCE);
    expect(hasPlaces(removePlaces(placed))).toBe(false);
  });

  it("renames a place and prunes the places of parts that are gone", () => {
    const placed = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
    expect([...readPlaces(renamePlace(placed, "Order", "Purchase")).keys()]).toEqual([
      "Purchase",
      "Customer",
    ]);
    expect(renamePlace(placed, "Missing", "Other")).toBe(placed);
    expect([...readPlaces(prunePlaces(placed, ["Customer", "Else"])).keys()]).toEqual(["Customer"]);
    expect(prunePlaces(placed, ["Customer", "Order"])).toBe(placed);
  });
});

describe("places across an edit of the structure", () => {
  const { read } = classStructure;

  it("drop the places of removed parts and put the block at the end again", () => {
    const before = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
    const removed = classStructure.remove(before, ["Customer"]);
    expect([...readPlaces(followPlaces(read, before, removed))]).toEqual([
      ["Order", { x: 1, y: 2 }],
    ]);
    const added = classStructure.add(before, { kind: "class" });
    const followed = followPlaces(read, before, added.source);
    expect(followed.trimEnd().split("\n").slice(-2)).toEqual(["%% @Order 1,2", "%% @Customer 3,4"]);
    expect(read(followed).nodes.map((node) => node.id)).toContain(added.id);
  });

  it("give a part's place to its new id", () => {
    const before = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
    const renamed = before.replaceAll("Order", "Purchase").replace("@Purchase", "@Order");
    expect([...readPlaces(followPlaces(read, before, renamed))]).toEqual([
      ["Purchase", { x: 1, y: 2 }],
      ["Customer", { x: 3, y: 4 }],
    ]);
  });

  it("keep the place with the part when ids that count parts pass on", () => {
    const notes = `${SOURCE}\n  note for Order "first"\n  note for Customer "second"`;
    const before = setPlaces(notes, { note1: { x: 10, y: 10 }, note2: { x: 500, y: 10 } });
    const after = classStructure.remove(before, ["note1"]);
    // The note that is left was `note2` and is `note1` now: it stands where it stood.
    expect([...readPlaces(followPlaces(read, before, after))]).toEqual([
      ["note1", { x: 500, y: 10 }],
    ]);
  });

  it("follow the final states of a state machine by what leads to them", () => {
    const machine = `stateDiagram-v2
  [*] --> A
  A --> [*]
  A --> B
  B --> [*]`;
    const ids = stateStructure.read(machine).nodes.map((node) => node.id);
    const [first, second] = ids.filter((id) => id.includes("final"));
    const before = setPlaces(machine, { [first]: { x: 1, y: 1 }, [second]: { x: 9, y: 9 } });
    // Without the first transition to an end, the end that is left is the one B leads to.
    const after = before.replace("  A --> [*]\n", "");
    const left = stateStructure.read(after).nodes.find((node) => node.id.includes("final"))!;
    expect(readPlaces(followPlaces(stateStructure.read, before, after)).get(left.id)).toEqual({
      x: 9,
      y: 9,
    });
  });

  it("carry the places of a part's other drawings with it", () => {
    const before = `${SOURCE}\n%% @Order 1,2\n%% @Order#2 5,6\n%% @Customer 3,4\n%% @stranger 7,8\n`;
    const after = before.replaceAll("Order", "Purchase").replaceAll("@Purchase", "@Order");
    expect([...readPlaces(followPlaces(read, before, after)).keys()]).toEqual([
      "Purchase",
      "Purchase#2",
      "Customer",
      "stranger",
    ]);
  });
});
