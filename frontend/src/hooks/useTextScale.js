import { useCallback, useEffect, useState } from 'react';

/* ============================================================================
   useTextScale — makes the masthead A- / A / A+ controls actually work.

   Every size in tokens.css is rem-based, so changing the root font-size scales
   the whole interface (GIGW 3.0 / WCAG 2.1 AA text resize). The choice is
   persisted so it survives navigation and reload.
   ============================================================================ */

const KEY = 'cdsco_text_scale';
export const SCALES = ['sm', 'md', 'lg'];
const CLASSES = SCALES.map(s => `text-scale-${s}`);

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return SCALES.includes(v) ? v : 'md';
  } catch {
    return 'md';
  }
}

export default function useTextScale() {
  const [scale, setScaleState] = useState(read);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...CLASSES);
    root.classList.add(`text-scale-${scale}`);
    try { localStorage.setItem(KEY, scale); } catch { /* private mode */ }
  }, [scale]);

  const setScale = useCallback(next => {
    if (SCALES.includes(next)) setScaleState(next);
  }, []);

  const step = useCallback(direction => {
    setScaleState(current => {
      const i = SCALES.indexOf(current);
      const next = Math.min(SCALES.length - 1, Math.max(0, i + direction));
      return SCALES[next];
    });
  }, []);

  return { scale, setScale, increase: () => step(1), decrease: () => step(-1) };
}
