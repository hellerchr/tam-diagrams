// Values remembered per browser (localStorage). Writes are debounced and flushed when the page hides, so a value that
// changes per pointer move costs one write; a private window (no storage) keeps them for the visit.

export function load<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

const pending = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();

function write(key: string) {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  clearTimeout(entry.timer);
  try {
    localStorage.setItem(key, JSON.stringify(entry.value));
  } catch {
    // no storage
  }
}

/** Store `value` (serialized when written, so a mutated object saves its latest state) after `delayMs` of quiet. */
export function save(key: string, value: unknown, delayMs = 300) {
  clearTimeout(pending.get(key)?.timer);
  pending.set(key, { value, timer: setTimeout(() => write(key), delayMs) });
}

addEventListener("pagehide", () => [...pending.keys()].forEach(write));
