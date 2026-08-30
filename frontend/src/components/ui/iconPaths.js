/* ============================================================================
   Monochrome 24x24 icon geometry. Stroke-based, inherits currentColor.
   Replaces every emoji in the reviewer console and the shared chrome — emoji
   render inconsistently across platforms and are announced unpredictably by
   screen readers, which is not acceptable on a government portal.

   Kept as raw geometry (not a dependency) so the project adds no package.
   ============================================================================ */

const ICONS = {
  /* --- navigation / chrome --- */
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.6v.6',
  download: 'M12 3v11m0 0 4-4m-4 4-4-4M4 17v2.5h16V17',
  pill: 'M8.5 3.5a5 5 0 0 1 7 7l-5 5a5 5 0 1 1-7-7ZM6 8l6 6',
  tag: 'M3 11.5V4h7.5L21 14.5 13.5 22 3 11.5ZM7.2 7.2h.01',
  phone: 'M6 3h3l2 5-2.5 1.5a12 12 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  fileText: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  helpCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.5M12 17h.01',
  megaphone: 'M4 10v4h3l7 4V6l-7 4H4ZM18 9a4 4 0 0 1 0 6',
  x: 'M6 6l12 12M18 6 6 18',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  chevronLeft: 'm14 6-6 6 6 6',
  chevronRight: 'm10 6 6 6-6 6',
  chevronsLeft: 'm11 6-6 6 6 6M18 6l-6 6 6 6',
  chevronsRight: 'm13 6 6 6-6 6M6 6l6 6-6 6',
  externalLink: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',

  /* --- status / KPI --- */
  layers: 'M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12.5 12 17l9-4.5M3 17 12 21.5 21 17',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3 9 9M15 15l2.7 2.7M17.7 6.3 15 9M9 15l-2.7 2.7',
  clipboardCheck: 'M9 4h6v2H9zM7 6H5.8A1.8 1.8 0 0 0 4 7.8v11.4A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8V7.8A1.8 1.8 0 0 0 18.2 6H17M9 14l2 2 4-4',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12.2l2.4 2.4 4.6-4.9',
  xCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6',
  alertTriangle: 'M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.2 1.9',

  /* --- table / controls --- */
  arrowUp: 'M12 19V5M12 5l-6 6M12 5l6 6',
  arrowDown: 'M12 5v14M12 19l-6-6M12 19l6-6',
  arrowUpDown: 'M8 4v16M8 4 5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  rows: 'M4 6h16M4 12h16M4 18h16',
  table: 'M4 5h16v14H4zM4 10h16M10 10v9',
  barChart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  slidersH: 'M4 8h10M18 8h2M4 16h4M12 16h8M14 5v6M8 13v6',
  lock: 'M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
};

export default ICONS;
export const ICON_NAMES = Object.keys(ICONS);
