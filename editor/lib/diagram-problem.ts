// Why a diagram's source draws nothing, as the editor shows it (lib/diagrams.ts, lib/tam-worker.ts): the library's
// error said as a message and its line.

/** Why a source draws nothing: the message, and its 1-based line (0: the whole source). */
export type Problem = { line: number; message: string };

/** The problem a thrown error says: its line when it has one, its message without the "Line n: " the library puts first. */
export function problemOf(error: unknown): Problem {
  const line = (error as { line?: unknown } | undefined)?.line;
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /^Line \d+: /,
    "",
  );
  return { line: typeof line === "number" ? line : 0, message };
}
