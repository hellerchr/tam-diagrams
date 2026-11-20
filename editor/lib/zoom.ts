// The pan and zoom of the picture viewer (ui/Lightbox.svelte) as plain math: a view is the picture's top left corner
// on screen and its scale, and every step returns a new view.

/** Where the picture's top left corner stands on screen, and its scale (1 is its own size). */
export type View = { x: number; y: number; zoom: number };
type Size = { width: number; height: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The view that shows the whole `picture` centred in `area`, as large as fits after `margin` on each side. */
export function fit(picture: Size, area: Size, margin = 0): View {
  const zoom = clamp(
    Math.min(
      (area.width - 2 * margin) / picture.width,
      (area.height - 2 * margin) / picture.height,
    ),
  );
  return center(picture, area, zoom);
}

/** The view at `zoom` with the picture centred in `area`. */
export function center(picture: Size, area: Size, zoom: number): View {
  const z = clamp(zoom);
  return {
    x: (area.width - picture.width * z) / 2,
    y: (area.height - picture.height * z) / 2,
    zoom: z,
  };
}

/** `view` zoomed to `zoom`, keeping the picture's point under screen point (`px`, `py`) where it is. */
export function zoomAt(view: View, zoom: number, px: number, py: number): View {
  const z = clamp(zoom);
  const k = z / view.zoom;
  return { x: px - (px - view.x) * k, y: py - (py - view.y) * k, zoom: z };
}

/** The zoom factor of one wheel event (a mouse wheel's lines counted as 16 pixels): a pinch on a trackpad (ctrlKey)
 *  moves in finer steps than a wheel. */
export function wheelFactor(e: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey">): number {
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  return Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
}

/** The zoom a typed percentage asks for ("150", "150%", " 80 % "), or undefined when it is not a number. */
export function parsePercent(text: string): number | undefined {
  const n = Number.parseFloat(text.replace("%", ""));
  return Number.isFinite(n) && n > 0 ? clamp(n / 100) : undefined;
}
