// Numbers and times for display.

// Formatters are made once: `toLocale…String` builds one per call, which costs a long list (the commit history) tens of ms.
// And on first use, not at import: each costs a few ms of locale data on the first load's path.
const once = (options: Intl.DateTimeFormatOptions) => {
  let format: Intl.DateTimeFormat | undefined;
  return (time: number) => (format ??= new Intl.DateTimeFormat(undefined, options)).format(time);
};
const day = once({ month: "short", day: "numeric" });

/** A full date and time, e.g. for a commit's tooltip. */
export const dateTime = once({ dateStyle: "medium", timeStyle: "short" });

export function age(time: number, now = Date.now()): string {
  const s = Math.max(0, (now - time) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return day(time);
}

/** A count and its noun, plural unless one: `3 files`, `1 file`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const cost = (dollars: number) =>
  dollars < 0.01 && dollars > 0 ? "<$0.01" : `$${dollars.toFixed(2)}`;

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** An absolute path with the home folder as `~`. */
export const tildePath = (path: string) => path.replace(/^\/home\/[^/]+/, "~");

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirname = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** `a.b.ts` → `ts`; "" without one. */
export const extname = (path: string) => {
  const name = basename(path);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
};

/** The folders containing `path`, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export const ancestors = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** `path` is `dir` or inside it. */
export const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/** Where `path` ends up when `from` moves to `to` (a file, or anything under a moved folder); undefined if unaffected. */
export const movedPath = (from: string, to: string, path: string) =>
  isUnder(path, from) ? to + path.slice(from.length) : undefined;

/** A project path as URL path segments. */
export const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
