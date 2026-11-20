// A lazily loaded chunk: `load()` imports it once (a failed import is tried again on the next call), `prefetch()`
// loads it when the browser is idle, so it is there when first needed; `started()` is the import if one began.
export function lazy<T>(importer: () => Promise<T>) {
  let chunk: Promise<T> | undefined;
  const load = () =>
    (chunk ??= importer().catch((error: unknown) => {
      chunk = undefined;
      throw error;
    }));
  return {
    load,
    prefetch: () => void requestIdleCallback(() => void load().catch(() => {}), { timeout: 3000 }),
    started: () => chunk,
  };
}
