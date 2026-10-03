/** Inline stroke icons (Lucide-style paths). Decorative unless a label is passed. */
type P = { label?: string; className?: string };
const svg = (d: React.ReactNode, { label, className }: P, sw = 2) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {d}
  </svg>
);

export const Check = (p: P) => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, p, 3);
export const Pause = (p: P) => svg(<><path d="M9 6v12" /><path d="M15 6v12" /></>, p, 3);
export const Ban = (p: P) => svg(<><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>, p, 2.4);
export const ArrowDown = (p: P) => svg(<><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></>, p, 2.4);
export const ArrowUp = (p: P) => svg(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>, p, 2.4);
export const ArrowRight = (p: P) => svg(<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>, p);
export const ArrowUpRight = (p: P) => svg(<><path d="M7 17L17 7" /><path d="M8 7h9v9" /></>, p);
export const Refresh = (p: P) => svg(<><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>, p);
export const Doc = (p: P) => svg(<><path d="M7 3h7l4 4v14H7z" /><path d="M10 11h5M10 15h5" /></>, p);
export const Chevron = (p: P) => svg(<path d="M6 9l6 6 6-6" />, p);
export const ChevronRight = (p: P) => svg(<path d="M9 6l6 6-6 6" />, p);
export const Layers = (p: P) => svg(<><path d="M5 8l7 4 7-4" /><path d="M5 12l7 4 7-4" /><path d="M5 16l7 4 7-4" /></>, p);
export const Minus = (p: P) => svg(<path d="M6 12h12" />, p, 3);
export const Fingerprint = (p: P) =>
  svg(
    <>
      <path d="M12 4a8 8 0 0 1 8 8v1" />
      <path d="M4 13v-1a8 8 0 0 1 4-6.9" />
      <path d="M8 12a4 4 0 0 1 8 0v2a8 8 0 0 1-1.2 4.2" />
      <path d="M12 12v2.5a10 10 0 0 1-2.5 6.5" />
      <path d="M6.3 17.5A10 10 0 0 0 8 14v-2" />
    </>,
    p,
    1.8,
  );

/** Wordmark glyph: a loop on a lead, three knots. */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
      <circle cx="9" cy="23" r="4.2" />
      <circle cx="22" cy="8" r="3.4" />
      <circle cx="24.5" cy="22.5" r="3" />
      <path d="M12.2 20.2L19.6 10.6" />
      <path d="M13.2 23.4h8.2" />
      <path d="M23.4 11.3l.8 8.2" />
    </svg>
  );
}
