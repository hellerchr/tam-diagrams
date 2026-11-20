// The files a diagram writes beside the one on show: an export (order.tam → order.svg) and the source a draw.io file
// converts to (order.drawio → order.tam). Path math only, so the draw.io view loads no drawing code for it.
import type { Format } from "./diagram-export.ts";

/** A diagram file's name without its extensions: `docs/order.tam` → `docs/order`, `a/b.drawio.svg` → `a/b`. */
export const stemOf = (path: string) =>
  path.replace(/(\.drawio)?\.(tam|mmd|mermaid|drawio|svg|xml)$/i, "");

/** The file an export of `path` is saved as beside it: `order.tam` → `order.svg`, `order.drawio`. */
export const besidePath = (path: string, format: Format) => `${stemOf(path)}.${format}`;

/** The names a draw.io file's converted source may take beside it, the plain one first: `order.tam`, `order-2.tam`… */
export const convertedPaths = (path: string, ext: "tam" | "mmd") =>
  Array.from({ length: 9 }, (_, i) => `${stemOf(path)}${i ? `-${i + 1}` : ""}.${ext}`);
