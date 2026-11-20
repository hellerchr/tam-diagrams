/**
 * The history of the diagram's source: every edit, on the canvas or typed, is a new source, and
 * Undo and Redo step between them. Typing that has not ended a statement joins the step before it,
 * so a word half typed is undone with the rest of its line.
 */

export class History {
  /** The sources before the one on show, the oldest first. */
  private past: string[] = [];
  /** The sources Undo stepped back from, the nearest last. */
  private future: string[] = [];
  /** The last step was typing that may take more typing. */
  private open = false;

  /** The source on show. */
  source: string;

  constructor(source: string) {
    this.source = source;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Takes `next` as the source; `join` lets it join the last step when that was such typing too. */
  edit(next: string, join = false) {
    if (next === this.source) return;
    if (!(join && this.open)) this.past.push(this.source);
    this.source = next;
    this.future = [];
    this.open = join;
  }

  /** Steps back (or forth, `redo`); the source on show after it. */
  step(redo: boolean): string {
    const [from, to] = redo ? [this.future, this.past] : [this.past, this.future];
    const next = from.pop();
    if (next !== undefined) {
      to.push(this.source);
      this.source = next;
    }
    this.open = false;
    return this.source;
  }
}
