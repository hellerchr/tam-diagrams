/** An error in a diagram source: what is wrong, and the line it is on (0 for the whole source). */
export class SourceError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(line ? `Line ${line}: ${message}` : message);
    this.line = line;
  }
}
