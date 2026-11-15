// The rules of the SAP TAM standard (2007): section 2.1.1.3 and appendix A, by the section that states each.
import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam.ts";
import { layoutPlaced } from "../src/tam-layout.ts";
import { overlapping } from "../src/tam-pin.ts";
import { arialMeasure } from "../src/arial-measure.ts";
import { checkSource } from "../cli/diagram.ts";

const accepts = (source: string) => expect(() => parseTam(source), source).not.toThrow();
const rejects = (source: string, message: RegExp) =>
  expect(() => parseTam(source), source).toThrow(message);

describe("TAM standard: nesting", () => {
  it("agents hold agents, storages, subsystems, components and classes (3.3.4)", () => {
    accepts("agent a {\nagent b\nhuman h\nstorage s\nsubsystem u\ncomponent c\nclass k\n}");
    rejects("agent a {\npackage p\n}", /cannot contain the package/);
  });

  it("a human agent holds nothing (3.3.4 [1])", () => {
    rejects("human h {\nstorage s\n}", /cannot contain elements/);
  });

  it("storages hold only storages (3.3.15 [4])", () => {
    accepts("storage s {\nstorage t {\nstorage u\n}\n}");
    for (const kind of ["agent", "human", "component", "subsystem", "class"])
      rejects(`storage s {\n${kind} a\n}`, /passive elements hold only storages/);
    rejects("storage s {\ngroup {\nagent a\n}\n}", /passive elements hold only storages/);
    rejects("storage s {\npackage p\n}", /cannot contain the package/);
  });

  it("components hold components, classes and storages; subsystems also subsystems (2.1.1.3)", () => {
    accepts("component c {\ncomponent d\nclass k\nstorage s\n}");
    rejects("component c {\nagent a\n}", /can contain components, classes and storages/);
    rejects("component c {\nsubsystem u\n}", /can contain components, classes and storages/);
    accepts("subsystem u {\nsubsystem v\ncomponent c\nclass k\nstorage s\n}");
    rejects("subsystem u {\nagent a\n}", /cannot contain the agent/);
    rejects("subsystem u {\ngroup {\nagent a\n}\n}", /can contain subsystems, components/);
  });

  it("the conceptual level has agents, storages, channels and accesses only (2.1.1.3)", () => {
    accepts("level conceptual\nagent a\nstorage s\nagent b\na -- reads --> s\na -- calls --> b");
    for (const kind of ["component", "subsystem", "class", "package"])
      rejects(`level conceptual\n${kind} a`, /belong to the design level/);
    rejects("level conceptual\nagent a\na provides I", /belong to the design level/);
  });
});

describe("TAM standard: connections", () => {
  it("a channel is defined between agents only (3.3.6 [1], 3.3.8 [1])", () => {
    accepts("agent a\nhuman h\nagent b\na -- calls --> b\nh --- a\nb -- sends data --> a");
    for (const kind of ["component", "subsystem", "class"])
      for (const word of ["-- calls -->", "-- sends data -->", "---"])
        rejects(`agent a\n${kind} c\na ${word} c`, /Channels join agents/);
    rejects("component c\ncomponent d\nc -- calls --> d", /connects through interfaces/);
    rejects("agent a\nstorage s\na -- calls --> s", /is a storage/);
    // Grouped agents, also with their storages, share a channel (3.3.4, figure 3-8).
    accepts("group g {\nagent a\nstorage s\n}\nagent b\ng -- calls --> b");
    rejects(
      "group g {\nagent a\ncomponent c\n}\nagent b\ng -- calls --> b",
      /Channels join agents/,
    );
  });

  it("requests go one way or both, data flows one way (3.3.6 [2])", () => {
    accepts("agent a\nagent b\na <-- calls --> b");
    rejects("agent a\nagent b\na <-- sends data --> b", /Data flows one way/);
  });

  it("an access joins one active element and a storage (3.3.1 [1])", () => {
    accepts(
      "agent a\ncomponent c\nsubsystem u\nclass k\nstorage s\na -- reads --> s\nc -- writes --> s\nu -- reads/writes --> s\nk -- reads --> s",
    );
    rejects("storage s\nstorage t\ns -- reads --> t", /active element to a storage/);
    rejects("agent a\nagent b\na -- writes --> b", /active element to a storage/);
    // Access directions as drawn: to the storage writes, from it reads.
    const [write, read, modify] = parseTam(
      "agent a\nstorage s\na -- writes --> s\na -- reads --> s\na -- reads/writes --> s",
    ).edges;
    expect([write.kind, read.kind, modify.kind]).toEqual(["write", "read", "modify"]);
  });

  it("components connect through provided and required interfaces (3.3.6, 2.1.1.3)", () => {
    accepts(
      "component c\ncomponent d\nagent a\nc -- requires IThing --> d\na -- requires IThing --> d\nc provides IOther",
    );
    rejects("storage s\ns provides I", /provide interfaces/);
    rejects("human h\nh provides I", /provide interfaces/);
    rejects("component c\nstorage s\nc -- requires I --> s", /Interfaces connect/);
  });

  it("a pointer joins storages, create and generate active elements (2.1.1.3, 3.3.9, 3.3.12)", () => {
    accepts(
      "storage s\nstorage t\nagent a\ncomponent c\ns -. pointer .-> t\na -. create .-> c\nc -. generate .-> a",
    );
    rejects("agent a\nstorage s\na -. pointer .-> s", /connects two storages/);
    rejects("agent a\nstorage s\na -. create .-> s", /connects active elements/);
    rejects("agent a\nstorage s\na -. generate .-> s", /connects active elements/);
  });
});

describe("TAM standard: several of a kind, and placing", () => {
  it("only agents and storages are shown as several (2.1.1.3, 3.3.11)", () => {
    accepts("agent a stack\nhuman h ...\nstorage s ...");
    for (const kind of ["component", "subsystem", "class", "package"])
      rejects(`${kind} c stack`, /Only agents and storages/);
    rejects("agent a\n...\nstorage s", /stands between elements of one kind/);
  });

  it("elements do not overlap (3.3.5): a layout by hand says which do", async () => {
    const overlaps = (source: string) => {
      const diagram = parseTam(source);
      return overlapping(diagram, layoutPlaced(diagram, arialMeasure));
    };
    expect(overlaps("agent a @0,0\nagent b @50,20")).toEqual([["a", "b"]]);
    expect(overlaps("agent a @0,0\nagent b @200,0")).toEqual([]);
    // A container holds its parts: that is no overlap. Two containers on each other are.
    expect(overlaps("agent a @0,0 300x200 {\nagent b @20,60\n}\nagent c @400,0")).toEqual([]);
    expect(overlaps("agent a @0,0 300x200 {\nagent b @20,60\n}\nagent c @280,0")).toEqual([
      ["a", "c"],
    ]);
    await expect(checkSource("agent a @0,0\nagent b @50,20")).rejects.toThrow(
      /`a` and `b` overlap/,
    );
    await expect(checkSource("agent a @0,0\nagent b @200,0")).resolves.toBeUndefined();
  });

  it("places the copy of an element shown as several", () => {
    const diagram = parseTam("agent a[A] ... @0,0 @0,100\nstorage s ... @300,0");
    const boxes = new Map(
      layoutPlaced(diagram, arialMeasure).shapes.map((shape) => [shape.id, shape.box]),
    );
    expect(boxes.get("a#2")).toMatchObject({ x: 0, y: 100 });
    // Without a position of its own the copy stands beside its original.
    expect(boxes.get("s#2")!.x).toBeGreaterThan(boxes.get("s")!.x + 90);
    expect(boxes.get("s#2")!.y).toBe(0);
    rejects("agent a @0,0 @0,100", /placed twice/);
    rejects("agent a ... @0,0 @0,100 @5,5", /more than two positions/);
    rejects("agent a ... @0,0 @0,100 20x20", /as large as its original/);
  });
});
