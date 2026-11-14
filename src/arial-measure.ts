import type { Measure } from "./text.ts";
import { BOLD, REGULAR, UNITS_PER_EM, type WidthRun } from "./font-widths.ts";

// East Asian wide and emoji characters, which fonts draw about one em wide. Script=Common ones are
// listed by range: the katakana middle dot, Bopomofo, enclosed CJK and CJK compatibility.
const WIDE =
  /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\u30FB\u30FC\u3100-\u312F\u31A0-\u31BF\u3200-\u33FF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6]/u;

/** Characters that draw nothing: invisible marks, joiners, variation selectors and combining marks. */
const ZERO_WIDTH: [first: number, last: number][] = [
  [0xad, 0xad],
  [0x300, 0x36f],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

/** Zero-width characters add no advance of their own. */
const isZeroWidth = (codePoint: number) =>
  ZERO_WIDTH.some(([first, last]) => codePoint >= first && codePoint <= last);

/** Half-width katakana and jamo match the scripts in WIDE but are drawn about half an em wide. */
const isHalfWidth = (codePoint: number) => codePoint >= 0xff61 && codePoint <= 0xffdc;

/** East Asian wide and emoji characters. */
const isWide = (char: string, codePoint: number) => !isHalfWidth(codePoint) && WIDE.test(char);

/** The advance of a code point in font units, or undefined outside the table's runs. */
function tableWidth(codePoint: number, runs: WidthRun[]): number | undefined {
  for (const [first, widths] of runs) {
    const offset = codePoint - first;
    if (offset >= 0 && offset < widths.length) return widths[offset];
  }
  return undefined;
}

/** Width of one character in em: the table, else 1 em if wide, else textMeasure's estimate. */
function advance(char: string, bold: boolean): number {
  const codePoint = char.codePointAt(0)!;
  if (isZeroWidth(codePoint)) return 0;
  const units = tableWidth(codePoint, bold ? BOLD : REGULAR);
  if (units !== undefined) return units / UNITS_PER_EM;
  if (isWide(char, codePoint)) return 1;
  return bold ? 0.62 : 0.58;
}

/**
 * Text width from advance widths of Arial, Helvetica and their metric twin Liberation Sans, for
 * Node, where no canvas exists. Kerning is ignored and the family is not consulted, so it fits only
 * that font family. Characters beyond the table get the estimate textMeasure falls back to.
 */
export const arialMeasure: Measure = (text, size, weight) => {
  const bold = weight >= 600;
  let em = 0;
  // Code points, not UTF-16 units: an emoji outside the BMP is one character. Composed first,
  // since decomposed text (macOS file names) would count a kana and its mark, or a Hangul
  // syllable's jamo, as several characters. The pass adds about a quarter to the time of an ASCII
  // label (0.1 µs a call), which layout does not notice.
  for (const char of text.normalize("NFC")) em += advance(char, bold);
  return em * size;
};
