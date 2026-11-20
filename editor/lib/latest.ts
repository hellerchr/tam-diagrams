/**
 * For searches as you type: `const search = latest()` then `search(call(...)).then(show)`. Only the newest call's
 * result arrives; older ones never resolve, so a slow reply can't overwrite a newer one.
 */
export function latest() {
  let seq = 0;
  return <T>(promise: Promise<T>): Promise<T> => {
    const mine = ++seq;
    return new Promise((resolve, reject) =>
      promise.then(
        (v) => mine === seq && resolve(v),
        (e) => mine === seq && reject(e),
      ),
    );
  };
}
