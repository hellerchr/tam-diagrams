import { describe, expect, it } from "vitest";
import type { Point, SceneWire } from "../src/scene";
import { bendsOn, touchesOtherWire } from "../src/wire-touch";

const route = (...coordinates: [number, number][]): Point[] =>
  coordinates.map(([x, y]) => ({ x, y }));

const wire = (edge: string, points: Point[]): SceneWire => ({ edge, points, ends: [], home: [] });

describe("bends lying on another wire", () => {
  const other = route([0, 0], [10, 0]);

  it("are the interior points within half a pixel of the other wire, and no others", () => {
    expect(bendsOn(route([5, 5], [5, 0.5], [30, 20]), other)).toEqual([{ x: 5, y: 0.5 }]);
    expect(bendsOn(route([5, 5], [5, 0.6], [30, 20]), other)).toEqual([]);
    expect(bendsOn(route([5, 5], [11, 0], [30, 20]), other)).toEqual([]);
  });

  it("leave out the route's own ends", () => {
    expect(bendsOn(route([5, 0], [5, 20]), other)).toEqual([]);
    expect(bendsOn(route([5, 20], [5, 0]), other)).toEqual([]);
  });
});

describe("a route touching another wire", () => {
  /** The wire being straightened, and one beside it that runs along y = 8 and turns at (12, 8). */
  const wires = [wire("a", route([0, 0], [0, 5])), wire("b", route([-10, 8], [12, 8], [12, 30]))];
  const touches = (points: Point[]) => touchesOtherWire(wires, wires[0], points);

  it("is one with a bend on the other wire", () => {
    expect(touches(route([0, 0], [30, 0], [30, 20]))).toBe(false);
    expect(touches(route([0, 0], [-5, 0], [-5, 8.4], [-5, 20]))).toBe(true);
  });

  it("is one that runs over a bend of the other wire", () => {
    expect(touches(route([0, 0], [30, 0], [30, 20]))).toBe(false);
    // Straight routes have no bends of their own, so only the other wire's bend can touch them.
    expect(touches(route([12, 0], [12, 15]))).toBe(true);
    expect(touches(route([12.4, 0], [12.4, 15]))).toBe(true);
    expect(touches(route([13, 0], [13, 15]))).toBe(false);
  });

  it("is not one that meets only the wire of its own connection", () => {
    const own = [wire("a", route([0, 0], [10, 0], [10, 10]))];
    expect(touchesOtherWire(own, own[0], route([10, 0], [10, 10]))).toBe(false);
  });
});
