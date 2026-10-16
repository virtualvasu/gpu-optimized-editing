// The look comes from the project's theme.json, passed in as props by vep. The engine holds no colours or text of its own:
// applyTheme() fills these live objects before a frame renders, and every component reads them at render time.
import { Easing, continueRender, delayRender } from 'remotion';

export const FPS = 30;
export const W = 1920, H = 1080;

export type Theme = {
  brand: { wordmark: string; site: string; url: string };
  colors: Record<string, string>;
  fonts: { sans: string; mono: string };
  assets: Record<string, string>;   // staticFile paths, filled in by vep
  endCard: { tagline: string; accent: string; url: string };
  labels: { recap: string };
  window: { x: number; y: number; w: number; h: number; bar: number; radius: number; titleBar: [string, string]; urlPill: string; lights: string[] };
  captions: { size: number; top: number; width: number };
  audio: { music: number; duck: number; sting: number; transition: number; endTransition: number };
  backdrop: { lines: [string, string, string][] };
};

export const C: Record<string, string> = {};
export const TH = {} as Theme;
export let FONT = 'sans-serif';
export let MONO = 'monospace';

const loaded = new Set<string>();
const loadGoogleFont = (family: string, weights: number[]) => {
  if (typeof document === 'undefined' || loaded.has(family)) return;
  loaded.add(family);
  const h = delayRender(`font ${family}`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(';')}&display=block`;
  link.onload = () => Promise.all(weights.map((w) => document.fonts.load(`${w} 40px "${family}"`))).then(() => continueRender(h), () => continueRender(h));
  link.onerror = () => { throw new Error(`theme font "${family}" could not be loaded from Google Fonts`); };
  document.head.appendChild(link);
};

export const applyTheme = (t: Theme) => {
  Object.assign(TH, t);
  Object.assign(C, t.colors);
  FONT = `"${t.fonts.sans}"`;
  MONO = `"${t.fonts.mono}"`;
  loadGoogleFont(t.fonts.sans, [400, 500, 600, 700, 800]);
  loadGoogleFont(t.fonts.mono, [400, 500]);
};

/** a theme colour (#RRGGBB) at an opacity */
export const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);       // fast start, long soft landing
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.5, 0, 0.9, 0.4);
export const sec = (s: number) => Math.round(s * FPS);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
