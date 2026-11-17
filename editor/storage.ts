/** What the editor remembers across visits: the browser's local storage, under the editor's own keys. */

const STORE = "tam-editor";

/** What was remembered under a key; null when nothing was, or the browser keeps no storage. */
export const stored = (key: string) => {
  try {
    return localStorage.getItem(`${STORE}:${key}`);
  } catch {
    return null;
  }
};

/** Remembers a value under a key, where the browser keeps storage. */
export const store = (key: string, value: string) => {
  try {
    localStorage.setItem(`${STORE}:${key}`, value);
  } catch {
    // Without storage the diagram lives as long as the page.
  }
};
