// @vitest-environment node
import { describe, expect, it } from "vitest";
import { colors, umlColors } from "./fixtures.ts";
import { arialMeasure, parseTam, renderTam, renderUml } from "../src/index.ts";
import { alongSides, offOutline } from "../src/audit.ts";
import { meetsSquare } from "../src/route.ts";
import { type Scene, STACK } from "../src/scene.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import * as UML from "../src/samples/uml-examples.ts";
import { generateTam } from "../src/samples/fuzz.ts";

const measure = { measure: arialMeasure };

/** A chat app whose push channel to FCM once ran down FCM's left side into its middle. */
const CHAT = `title How the chat app is built
direction LR
agent ios[iOS app]
agent android[Android app]
agent chat[Chat backend] {
  agent gateway[WebSocket gateway]
  agent messages[Message service]
  agent presence[Presence service]
  storage cassandra[Messages<br>Cassandra]
  storage online[Online users<br>Redis]
  storage pubsub[Redis pub/sub]
}
agent fcm[FCM]
agent apns[APNs]
ios & android <-- calls: chat @WebSocket --> gateway
gateway -- calls: send message --> messages
messages -- sends data: deliver message --> gateway
gateway -- calls: connect, disconnect --> presence
messages -- calls: is user online? --> presence
messages -- reads/writes --> cassandra
presence -- reads/writes --> online
messages & presence -- reads/writes: events --> pubsub
messages -- calls: push --> fcm
messages -- calls: push --> apns
fcm -- sends data: notification --> android
apns -- sends data: notification --> ios
`;

describe("a wire's end", () => {
  it("meets a side square, across it, and never along it", () => {
    const box = { x: 100, y: 100, width: 80, height: 40 };
    expect(meetsSquare({ x: 100, y: 120 }, { x: 60, y: 120 }, box)).toBe(true);
    expect(meetsSquare({ x: 140, y: 100 }, { x: 140, y: 40 }, box)).toBe(true);
    // Down the left side into its middle: along the side.
    expect(meetsSquare({ x: 100, y: 120 }, { x: 100, y: 20 }, box)).toBe(false);
    expect(meetsSquare({ x: 140, y: 140 }, { x: 200, y: 140 }, box)).toBe(false);
    // An end on no side, such as one on a curved outline, is not judged.
    expect(meetsSquare({ x: 90, y: 90 }, { x: 90, y: 20 }, box)).toBe(true);
  });

  it("meets FCM square: the push channel comes in across its side", async () => {
    const { scene } = await renderTam(CHAT, colors, measure);
    expect(alongSides(scene)).toEqual([]);
    const fcm = scene.shapes.find((shape) => shape.id === "fcm")!.box;
    const into = scene.wires
      .filter((wire) => wire.edge === "e11")
      .map((wire) => wire.points)
      .find((points) => Math.abs(points.at(-1)!.x - fcm.x) < 0.5)!;
    expect(into.at(-2)!.y).toBeCloseTo(into.at(-1)!.y);
  });

  it.each([94, 161, 217, 394])(
    "meets every element square in generated block diagram %i",
    async (seed) => {
      const { scene } = await renderTam(generateTam(seed), colors, measure);
      expect(alongSides(scene)).toEqual([]);
    },
  );

  it("meets every element square in the samples of every type", async () => {
    const found: string[] = [];
    for (const [name, source] of TAM_EXAMPLES.filter(([name]) => !name.startsWith("error"))) {
      const { scene } = await renderTam(source, colors, measure);
      found.push(...alongSides(scene).map((finding) => `${name}: ${finding.detail}`));
    }
    const samples = Object.values(UML).filter(Array.isArray) as [string, string][][];
    for (const [name, source] of samples.flat()) {
      const { scene } = await renderUml(source, umlColors, measure);
      found.push(...alongSides(scene).map((finding) => `${name}: ${finding.detail}`));
    }
    expect(found).toEqual([]);
  }, 60_000);
});

/** How far each end of every reads/writes loop lies from its elements' outlines: the front or back card of a stack. */
function loopEndsOff(source: string, scene: Scene): string[] {
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const cards = (id: string) => {
    const shape = shapes.get(id);
    if (!shape) return [];
    const back = { ...shape.box, x: shape.box.x + STACK, y: shape.box.y + STACK };
    return shape.stack ? [shape, { ...shape, box: back }] : [shape];
  };
  return parseTam(source)
    .edges.filter((edge) => edge.kind === "modify")
    .flatMap((edge) =>
      scene.wires
        .filter((wire) => wire.edge === edge.id)
        .flatMap((wire) => [wire.points[0], wire.points.at(-1)!])
        .map((end) =>
          Math.min(
            ...[edge.source, edge.target].flatMap(cards).map((shape) => offOutline(end, shape)),
          ),
        )
        .filter((off) => off > 1)
        .map((off) => `${edge.id} ${off.toFixed(1)}px off`),
    );
}

describe("a reads/writes access", () => {
  it("ends both its lines on a stacked storage's front shape, none beside its curve", async () => {
    const source = generateTam(40);
    const { scene } = await renderTam(source, colors, measure);
    expect(loopEndsOff(source, scene)).toEqual([]);
  });

  it("ends every line on its elements' outlines in the block diagram samples", async () => {
    const found: string[] = [];
    for (const [name, source] of TAM_EXAMPLES.filter(([name]) => !name.startsWith("error"))) {
      const { scene } = await renderTam(source, colors, measure);
      found.push(...loopEndsOff(source, scene).map((off) => `${name}: ${off}`));
    }
    expect(found).toEqual([]);
  }, 60_000);
});
