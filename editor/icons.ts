/** The editor's icons, 20 by 20, drawn with the current text color. The element icons are the TAM shapes. */

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
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
  save: svg('<path d="M10 3v9.500M6 9l4 4 4-4M3.500 16.500h13"/>'),
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
  chevron: svg('<path d="M6 8l4 4 4-4"/>'),
  fold: svg(
    '<rect x="2.500" y="3.500" width="15" height="13" rx="1.500"/><path d="M7.500 3.500v13"/>',
  ),
  layout: svg(
    '<rect x="7" y="2.500" width="6" height="4"/><rect x="2" y="13.500" width="6" height="4"/><rect x="12" y="13.500" width="6" height="4"/><path d="M10 6.500v3.500M5 13.500V10h10v3.500"/>',
  ),
} as const;
