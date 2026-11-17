// Toolbar icons, drawn for this project as simple 24×24 stroke paths (no icon library).
const P: Record<string, string> = {
  new: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M12 12v6 M9 15h6',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 3v5h8V3 M7 21v-7h10v7',
  print: 'M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6z',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  minus: 'M6 12h12',
  plus: 'M12 6v12 M6 12h12',
  fitWidth: 'M3 5v14 M21 5v14 M7 12h10 M10 9l-3 3 3 3 M14 9l3 3-3 3',
  fitPage: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 7v10 M9.5 9.5 12 7l2.5 2.5 M9.5 14.5 12 17l2.5-2.5',
  rotateLeft: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5 M3.5 3.5v5h5',
  rotateRight: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6 M20.5 3.5v5h-5',
  duplicate: 'M9 9h11v11H9z M5 15H4V4h11v1',
  insertFile: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M12 11v7 M9 15l3 3 3-3',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14 M18 22V8a2 2 0 0 0-2-2H2',
  extract: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M12 18v-7 M9 14l3-3 3 3',
  split: 'M3 5h7v14H3z M14 5h7v14h-7z',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 10.5v6 M14 10.5v6',
  select: 'M5 3.5l13.5 7-5.8 1.8-1.9 6.2z',
  highlight: 'M4 20h7 M14.5 4.5l5 5-8 8H6.5v-5z',
  underline: 'M6 4v7a6 6 0 0 0 12 0V4 M4 20h16',
  strike: 'M4 12h16 M16.5 7C15.6 5.2 14 4.3 12 4.3c-2.6 0-4.6 1.4-4.6 3.4 M7.5 16.5c.9 1.9 2.6 3.2 4.7 3.2 2.7 0 4.9-1.6 4.9-3.8',
  note: 'M4 5h16v11H9.5L5 20v-4H4z M8 9h8 M8 12.5h5',
  textBox: 'M4 4h16v16H4z M8 8h8 M12 8v9',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5.5c5 0 9 2.9 9 6.5s-4 6.5-9 6.5-9-2.9-9-6.5 4-6.5 9-6.5z',
  draw: 'M3 17c2.5-3.5 4.5-9 7.5-9 2.5 0 1.5 7 4.5 7 2.3 0 3.3-3 6-5.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sign: 'M14.5 4.5l5 5L10 19H5v-5z M3 22h18',
  redact: 'M3 6.5h18v4H3z M3 14h12v4H3z',
  sanitize: 'M7 21h12 M5.5 13.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 20H8.5z M9 10l5 5',
  lock: 'M5.5 11h13v10h-13z M8 11V7.5a4 4 0 0 1 8 0V11',
  certificate: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M8.5 12l2.5 2.5 4.5-4.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.5',
  warning: 'M12 3.5 2.5 20h19z M12 10v4.5 M12 17.4v.2',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  cut: 'M6 7a3 3 0 1 0 0-.01 M6 17a3 3 0 1 0 0 .01 M8.6 8.5 20 18 M8.6 15.5 20 6',
  paste: 'M8 4h8v3H8z M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z',
  check: 'M4 13l5 5L20 6',
  cross: 'M6 6l12 12 M18 6 6 18',
  dot: 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  box: 'M5 5h14v14H5z',
  line: 'M4 12h16',
  plus2: 'M12 5v14 M5 12h14',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  export: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 14h8 M13 11l3 3-3 3',
  scan: 'M4 8V5h3 M17 5h3v3 M20 16v3h-3 M7 19H4v-3 M4 12h16',
  download: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 20h14',
  find: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5 20 20',
  sidebar: 'M4 5h16v14H4z M9.5 5v14',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
  headerFooter: 'M6 3h12v18H6z M9 6.5h6 M9 17.5h6 M9 10.5h6 M9 13.5h4',
};
P.blankPage = P.new!;
const FILLED = new Set(['redact', 'dot']);

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={FILLED.has(name) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}
