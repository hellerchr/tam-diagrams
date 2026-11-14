// @vitest-environment node
import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/index";

/** Width per 1000 em, rounded, as Adobe's Helvetica AFM files list it. */
const per1000 = (text: string, weight: number) => Math.round(arialMeasure(text, 1000, weight));

/** A code point as U+XXXX, for test names. */
const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe("arialMeasure", () => {
  // Values from the Adobe Helvetica AFM files (independent of the generated table); Arial and
  // Liberation Sans match them to within a unit.
  it.each([
    ["regular space", " ", 400, 278],
    ["regular i", "i", 400, 222],
    ["regular m", "m", 400, 833],
    ["regular W", "W", 400, 944],
    ["bold i", "i", 700, 278],
    ["bold m", "m", 700, 889],
    ["tilde, last of the ASCII run", "~", 400, 584],
    ["guillemet, Latin-1", "«", 400, 556],
    ["e acute, Latin-1", "é", 400, 556],
    ["y diaeresis, last of Latin-1", "ÿ", 400, 500],
    ["en dash", "–", 400, 556],
    ["em dash", "—", 400, 1000],
    ["ellipsis", "…", 400, 1000],
    ["euro", "€", 400, 556],
  ])("reproduces the %s", (_name, text, weight, expected) => {
    expect(Math.abs(per1000(text, weight) - expected)).toBeLessThanOrEqual(1);
  });

  it("scales linearly with the size", () => {
    expect(arialMeasure("Order service", 28, 400)).toBeCloseTo(
      2 * arialMeasure("Order service", 14, 400),
      9,
    );
  });

  it("uses Bold from weight 600 and Regular below", () => {
    const [regular, medium, semibold, bold] = [400, 500, 600, 700].map((weight) =>
      arialMeasure("mmm", 10, weight),
    );
    expect(medium).toBe(regular);
    expect(semibold).toBe(bold);
    expect(bold).toBeGreaterThan(regular);
  });

  it("tells narrow letters from wide ones, which the estimate cannot", () => {
    expect(arialMeasure("iiii", 14, 400)).toBeLessThan(arialMeasure("mmmm", 14, 400));
  });

  it("is the sum of its characters, without kerning", () => {
    const text = "AVATAR: Waves";
    const sum = [...text].reduce((total, char) => total + arialMeasure(char, 14, 400), 0);
    expect(arialMeasure(text, 14, 400)).toBeCloseTo(sum, 9);
  });

  // The emoji lies outside the BMP: one character, not two UTF-16 units.
  it.each(["漢", "ひ", "カ", "ー", "한", "，", "😀"])("gives %s one em at either weight", (text) => {
    expect(arialMeasure(text, 14, 400)).toBe(14);
    expect(arialMeasure(text, 14, 700)).toBe(14);
  });

  it("adds nothing for joiners, variation selectors and combining marks", () => {
    expect(arialMeasure("e\u0301", 14, 400)).toBe(arialMeasure("e", 14, 400));
    expect(arialMeasure("a\u200db\u200b", 14, 400)).toBe(arialMeasure("ab", 14, 400));
    expect(arialMeasure("\u2764\ufe0f", 14, 400)).toBe(arialMeasure("\u2764", 14, 400));
  });

  // First and last code point of each run of characters that draw nothing; the neighbours outside
  // it still count.
  it.each(
    [
      [0xad, 0xad],
      [0x300, 0x36f],
      [0x200b, 0x200f],
      [0x2060, 0x2064],
      [0x2066, 0x2069],
      [0xfe00, 0xfe0f],
      [0xfeff, 0xfeff],
    ].map(([first, last]) => [`${hex(first)}-${hex(last)}`, first, last] as const),
  )("draws nothing for %s, and something either side", (_name, first, last) => {
    // x and y have no composed form with a combining mark, which would hide the mark's width.
    const [x, y] = ["x", "y"].map((char) => arialMeasure(char, 14, 400));
    const inside = (cp: number) => arialMeasure(`x${String.fromCodePoint(cp)}y`, 14, 400);
    expect(inside(first)).toBe(x + y);
    expect(inside(last)).toBe(x + y);
    expect(inside(first - 1)).toBeGreaterThan(x + y);
    expect(inside(last + 1)).toBeGreaterThan(x + y);
  });

  // Script=Common wide characters: the middle dot of katakana, Bopomofo, enclosed CJK and CJK
  // compatibility (first and last of each block), and the compatibility forms.
  it.each(
    [0x30fb, 0x3100, 0x3105, 0x312f, 0x31a0, 0x31bf, 0x3200, 0x3231, 0x33ff, 0xfe30, 0xfe4f].map(
      (cp) => [hex(cp), cp] as const,
    ),
  )("gives %s one em at either weight", (_name, cp) => {
    expect(arialMeasure(String.fromCodePoint(cp), 14, 400)).toBe(14);
    expect(arialMeasure(String.fromCodePoint(cp), 14, 700)).toBe(14);
  });

  // Half-width katakana and jamo are drawn about half an em: they get the estimate, while the
  // full-width forms on either side keep one em.
  it.each([0xff61, 0xff66, 0xff71, 0xff9d, 0xff9f, 0xffa0, 0xffdc].map((cp) => [hex(cp), cp] as const))(
    "gives half-width %s the estimate",
    (_name, cp) => {
      expect(arialMeasure(String.fromCodePoint(cp), 100, 400)).toBeCloseTo(58, 9);
      expect(arialMeasure(String.fromCodePoint(cp), 100, 700)).toBeCloseTo(62, 9);
    },
  );

  it.each([0xff60, 0xffe0].map((cp) => [hex(cp), cp] as const))(
    "keeps %s, next to the half-width forms, at one em",
    (_name, cp) => {
      expect(arialMeasure(String.fromCodePoint(cp), 14, 400)).toBe(14);
    },
  );

  it("measures decomposed text like its composed form", () => {
    expect(arialMeasure("\u30ab\u3099", 14, 400)).toBe(14);
    expect(arialMeasure("\u1112\u1161\u11ab", 14, 400)).toBe(14);
    expect(arialMeasure("A\u030a", 14, 400)).toBe(arialMeasure("\u00c5", 14, 400));
  });

  it("adds nothing for a combining mark that stays decomposed", () => {
    expect(arialMeasure("x\u0301", 14, 400)).toBe(arialMeasure("x", 14, 400));
  });

  // Extended_Pictographic also matches the copyright sign, which the table gives its own width.
  it("takes a character's width from the table before calling it wide", () => {
    expect(Math.abs(per1000("\u00a9", 400) - 737)).toBeLessThanOrEqual(1);
  });

  it("gives characters beyond the table the estimate of textMeasure", () => {
    expect(arialMeasure("\u0410", 100, 400)).toBeCloseTo(58, 9);
    expect(arialMeasure("\u0410", 100, 600)).toBeCloseTo(62, 9);
  });

  it("measures the empty string as zero", () => {
    expect(arialMeasure("", 14, 400)).toBe(0);
  });
});
