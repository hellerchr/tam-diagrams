/** The editor's icons, 20 by 20, drawn with the current text color. The element icons are the TAM shapes. */

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  // The shapes of the UML diagrams, for the tiles that add their statements.
  "uml-interface": svg(
    '<rect x="3" y="3.500" width="14" height="13"/><path d="M3 8.500h14"/><circle cx="10" cy="6" r="1.300"/>',
  ),
  "uml-inherit": svg(
    '<path d="M3 16L11.500 7.500"/><path d="M11 4l5 0 0 5z" fill="var(--panel, #fff)"/>',
  ),
  "uml-arrow": svg('<path d="M3 16L16 4"/><path d="M10.500 4H16v5.500"/>'),
  "uml-compose": svg(
    '<path d="M9.500 10.500L17 3"/><path d="M3 17l2-5.500 4.500 1L7.500 17z" fill="currentColor"/>',
  ),
  "uml-aggregate": svg(
    '<path d="M9.500 10.500L17 3"/><path d="M3 17l2-5.500 4.500 1L7.500 17z" fill="var(--panel, #fff)"/>',
  ),
  "uml-realize": svg(
    '<path d="M3 16L11.500 7.500" stroke-dasharray="3 2.500"/><path d="M11 4l5 0 0 5z" fill="var(--panel, #fff)"/>',
  ),
  "uml-link": svg('<path d="M3 16L16 4"/>'),
  "uml-dashed-link": svg('<path d="M3 16L16 4" stroke-dasharray="3 2.500"/>'),
  "uml-abstract": svg(
    '<rect x="3" y="3.500" width="14" height="13" stroke-dasharray="3 2"/><path d="M3 8.500h14"/>',
  ),
  "uml-enum": svg(
    '<rect x="3" y="3.500" width="14" height="13"/><path d="M3 8.500h14M6 11.500h.100M6 14h.100M8.500 11.500h5.500M8.500 14h5.500"/>',
  ),
  "uml-dashed": svg(
    '<path d="M3 16L16 4" stroke-dasharray="3 2.500"/><path d="M10.500 4H16v5.500"/>',
  ),
  "uml-actor": svg(
    '<circle cx="10" cy="4.500" r="2.300"/><path d="M10 6.800v6M5.500 9.500h9M6.500 17.500l3.500-4.700 3.500 4.700"/>',
  ),
  "uml-usecase": svg('<ellipse cx="10" cy="10" rx="7.500" ry="4.500"/>'),
  "uml-system": svg(
    '<rect x="2.500" y="3" width="15" height="14"/><ellipse cx="10" cy="11" rx="4.500" ry="2.800"/>',
  ),
  "uml-step": svg('<rect x="2.500" y="5.500" width="15" height="9" rx="3"/>'),
  "uml-decision": svg('<path d="M10 3l7 7-7 7-7-7z"/>'),
  "uml-start": svg('<circle cx="10" cy="10" r="5" fill="currentColor"/>'),
  "uml-end": svg(
    '<circle cx="10" cy="10" r="6.500"/><circle cx="10" cy="10" r="3.500" fill="currentColor"/>',
  ),
  "uml-lane": svg('<rect x="2.500" y="3" width="15" height="14"/><path d="M2.500 7h15M10 3v14"/>'),
  "uml-composite": svg(
    '<rect x="2.500" y="3.500" width="15" height="13" rx="3"/><path d="M2.500 7.500h15"/><rect x="6" y="10" width="8" height="4" rx="1.500"/>',
  ),
  "uml-note": svg('<path d="M4 3h8.500L16 6.500V17H4z"/><path d="M12.500 3v3.500H16"/>'),
  "uml-participant": svg(
    '<rect x="4.500" y="2.500" width="11" height="5.500"/><path d="M10 8v9.500" stroke-dasharray="2.500 2"/>',
  ),
  "uml-message": svg('<path d="M3 10h13"/><path d="M12 6l4.500 4-4.500 4" fill="currentColor"/>'),
  "uml-reply": svg('<path d="M17 10H4" stroke-dasharray="3 2.500"/><path d="M8 6l-4.500 4L8 14"/>'),
  "uml-frame": svg(
    '<rect x="2.500" y="3.500" width="15" height="13"/><path d="M2.500 8h5l1.500-1.500V3.500M2.500 12h15" /><path d="M2.500 12h15" stroke-dasharray="2.500 2"/>',
  ),
  "uml-loop": svg(
    '<rect x="2.500" y="3.500" width="15" height="13"/><path d="M2.500 8h5l1.500-1.500V3.500"/><path d="M13.500 10.500a2.500 2.500 0 1 1-1-2"/><path d="M12.800 7v1.800h-1.800"/>',
  ),
  logo: svg(
    '<rect x="2" y="3" width="7" height="5"/><rect x="11" y="12" width="7" height="5" rx="2.5"/><path d="M5.500 8v6.500h5.500"/>',
  ),
  select: svg(
    '<path d="M5 3l10 6.500-4.500 1.200L8.300 15z" fill="currentColor" fill-opacity=".15"/>',
  ),
  pan: svg(
    '<path d="M10 2.500v15M2.500 10h15M10 2.500l-2 2M10 2.500l2 2M10 17.500l-2-2M10 17.500l2-2M2.500 10l2-2M2.500 10l2 2M17.500 10l-2-2M17.500 10l-2 2"/>',
  ),
  connect: svg(
    '<circle cx="4" cy="15" r="2"/><circle cx="16" cy="5" r="2"/><path d="M5.500 13.500l9-7"/>',
  ),
  agent: svg('<rect x="2.500" y="5" width="15" height="10"/>'),
  human: svg(
    '<rect x="2.500" y="2" width="15" height="16"/><circle cx="10" cy="6.500" r="1.800"/><path d="M10 8.300v4M7 10h6M8 15l2-2.700 2 2.700"/>',
  ),
  storage: svg('<rect x="2.500" y="5.500" width="15" height="9" rx="4.500"/>'),
  group: svg(
    '<rect x="2.500" y="4" width="15" height="12" rx="2" stroke-dasharray="2.500 2.500"/>',
  ),
  component: svg(
    '<rect x="4.500" y="4" width="13" height="12"/><rect x="2" y="6.500" width="5" height="2.500" fill="var(--panel, #fff)"/><rect x="2" y="11" width="5" height="2.500" fill="var(--panel, #fff)"/>',
  ),
  subsystem: svg(
    '<rect x="2.500" y="3.500" width="15" height="13"/><path d="M5.500 7h3M5.500 10h9M5.500 13h9"/>',
  ),
  class: svg('<rect x="3" y="3.500" width="14" height="13"/><path d="M3 8h14M3 12h14"/>'),
  package: svg(
    '<path d="M2.500 7.500V4h6v3.500"/><rect x="2.500" y="7.500" width="15" height="9"/>',
  ),
  undo: svg('<path d="M7 5L3.500 8.500 7 12"/><path d="M3.500 8.500h8a4.500 4.500 0 0 1 0 9H9"/>'),
  redo: svg(
    '<path d="M13 5l3.500 3.500L13 12"/><path d="M16.500 8.500h-8a4.500 4.500 0 0 0 0 9H11"/>',
  ),
  plus: svg('<path d="M10 4.500v11M4.500 10h11"/>'),
  minus: svg('<path d="M4.500 10h11"/>'),
  fit: svg('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>'),
  file: svg('<path d="M5 2.500h6.500L15 6v11.500H5z"/><path d="M11.500 2.500V6H15"/>'),
  open: svg('<path d="M2.500 15.500v-11h5l1.500 2h8.500v9z"/>'),
  save: svg(
    '<path d="M3.500 3.500h10.500l2.500 2.500v10.500h-13z"/><path d="M6.500 3.500v4h6v-4M6.500 16.500v-5h7v5"/>',
  ),
  export: svg('<path d="M10 12.500V3M6.500 6.500L10 3l3.500 3.500M3.500 11v5.500h13V11"/>'),
  image: svg(
    '<rect x="2.500" y="3.500" width="15" height="13" rx="1.500"/><path d="M2.500 13.500l4-4 3.500 3.500 2.500-2.500 5 5"/><circle cx="13" cy="7.500" r="1.300"/>',
  ),
  copy: svg('<rect x="7" y="7" width="10" height="10" rx="1.500"/><path d="M13 7V3H3v10h4"/>'),
  theme: svg('<path d="M16.500 11.500A7 7 0 0 1 8.500 3.500a7 7 0 1 0 8 8z"/>'),
  "align-left": svg(
    '<path d="M3 2.500v15"/><rect x="5.500" y="5" width="10" height="3.500"/><rect x="5.500" y="11.500" width="6" height="3.500"/>',
  ),
  "align-center": svg(
    '<path d="M10 2.500v15"/><rect x="4.500" y="5" width="11" height="3.500"/><rect x="6.500" y="11.500" width="7" height="3.500"/>',
  ),
  "align-right": svg(
    '<path d="M17 2.500v15"/><rect x="4.500" y="5" width="10" height="3.500"/><rect x="8.500" y="11.500" width="6" height="3.500"/>',
  ),
  "align-top": svg(
    '<path d="M2.500 3h15"/><rect x="5" y="5.500" width="3.500" height="10"/><rect x="11.500" y="5.500" width="3.500" height="6"/>',
  ),
  "align-middle": svg(
    '<path d="M2.500 10h15"/><rect x="5" y="4.500" width="3.500" height="11"/><rect x="11.500" y="6.500" width="3.500" height="7"/>',
  ),
  "align-bottom": svg(
    '<path d="M2.500 17h15"/><rect x="5" y="4.500" width="3.500" height="10"/><rect x="11.500" y="8.500" width="3.500" height="6"/>',
  ),
  "spread-x": svg('<path d="M3 3v14M17 3v14"/><rect x="8" y="6" width="4" height="8"/>'),
  "spread-y": svg('<path d="M3 3h14M3 17h14"/><rect x="6" y="8" width="8" height="4"/>'),
  "same-width": svg(
    '<rect x="3" y="4" width="14" height="4"/><rect x="3" y="12" width="14" height="4"/>',
  ),
  "same-height": svg(
    '<rect x="4" y="3" width="4" height="14"/><rect x="12" y="3" width="4" height="14"/>',
  ),
  "fit-size": svg(
    '<rect x="5.500" y="5.500" width="9" height="9"/><path d="M2 2l2.500 2.500M18 2l-2.500 2.500M2 18l2.500-2.500M18 18l-2.500-2.500"/>',
  ),
  snap: svg(
    '<path d="M5 3v7a5 5 0 0 0 10 0V3h-3.500v7a1.500 1.500 0 0 1-3 0V3z"/><path d="M5 6h3.500M11.500 6H15"/>',
  ),
  expand: svg('<path d="M6 8l4 4 4-4"/><path d="M4 16h12"/>'),
  collapse: svg('<path d="M6 12l4-4 4 4"/><path d="M4 4h12"/>'),
  help: svg(
    '<circle cx="10" cy="10" r="7.500"/><path d="M7.800 8a2.300 2.300 0 1 1 3.300 2.100c-.700.400-1.100.900-1.100 1.700"/><path d="M10 14.300v.100"/>',
  ),
  link: svg(
    '<path d="M8.500 11.500a3 3 0 0 0 4.300 0l3-3a3 3 0 0 0-4.300-4.300l-1 1"/><path d="M11.500 8.500a3 3 0 0 0-4.300 0l-3 3a3 3 0 0 0 4.300 4.300l1-1"/>',
  ),
  chevron: svg('<path d="M6 8l4 4 4-4"/>'),
  fold: svg(
    '<rect x="2.500" y="3.500" width="15" height="13" rx="1.500"/><path d="M7.500 3.500v13"/>',
  ),
  layout: svg(
    '<rect x="7" y="2.500" width="6" height="4"/><rect x="2" y="13.500" width="6" height="4"/><rect x="12" y="13.500" width="6" height="4"/><path d="M10 6.500v3.500M5 13.500V10h10v3.500"/>',
  ),
  "chevron-right": svg('<path d="M8 6l4 4-4 4"/>'),
  check: svg('<path d="M4.500 10.500l3.500 3.500 7.500-8"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  shapes: svg(
    '<rect x="2.500" y="2.500" width="6.500" height="6.500"/><circle cx="14.200" cy="5.800" r="3.300"/><rect x="2.500" y="12" width="15" height="5.500" rx="2.750"/>',
  ),
  outline: svg('<path d="M3 4.500h8M6 10h9M6 15.500h9M3.500 7v8.500h.500M3.500 10h.500"/>'),
  panel: svg(
    '<rect x="2.500" y="3.500" width="15" height="13" rx="1.500"/><path d="M12.500 3.500v13"/>',
  ),
  warning: svg('<path d="M10 3l7.500 13.500h-15z"/><path d="M10 8.500v3.500M10 14.300v.100"/>'),
  "arrow-down": svg('<path d="M10 3.500v13M5 11.500l5 5 5-5"/>'),
  "arrow-right": svg('<path d="M3.500 10h13M11.500 5l5 5-5 5"/>'),
  "arrow-up": svg('<path d="M10 16.500v-13M5 8.500l5-5 5 5"/>'),
  "arrow-left": svg('<path d="M16.500 10h-13M8.500 5l-5 5 5 5"/>'),
  usecase: svg(
    '<ellipse cx="12.500" cy="10" rx="5.500" ry="3.500"/><circle cx="3.500" cy="6.500" r="1.300"/><path d="M3.500 7.800v4M1.500 9.500h4M2 14.500l1.500-2.700L5 14.500"/>',
  ),
  flowchart: svg(
    '<rect x="6.500" y="2" width="7" height="4" rx="2"/><path d="M10 9l3.500 2.500L10 14l-3.500-2.500z"/><path d="M10 6v3M10 14v3.500"/>',
  ),
  swimlane: svg(
    '<rect x="2.500" y="3" width="15" height="14"/><path d="M10 3v14M2.500 6.500h15"/><rect x="4.500" y="9" width="3.500" height="2.500"/><rect x="12" y="13" width="3.500" height="2.500"/>',
  ),
  state: svg(
    '<circle cx="3.500" cy="10" r="1.500" fill="currentColor"/><rect x="8.500" y="6.500" width="9" height="7" rx="2.500"/><path d="M5 10h3.500"/>',
  ),
  sequence: svg(
    '<rect x="2.500" y="2.500" width="5" height="3"/><rect x="12.500" y="2.500" width="5" height="3"/><path d="M5 5.500v12M15 5.500v12M5 9h10M12.500 7l2.500 2-2.500 2M15 14H5"/>',
  ),
} as const;

/** The name of an icon. */
export type IconName = keyof typeof ICONS;
