/**
 * A tiny per-environment visual identity for the UI chrome — one accent
 * colour and a font treatment that suits the world's mood. Used by the
 * title screen (to tint the selected cell) and the in-world HUD (the
 * filename is drawn "in a style that represents the environment").
 *
 * This is deliberately UI-only and hand-picked; it does not read from the
 * scene `WorldDefinition`s (Floating Islands isn't one of those anyway).
 */
export interface EnvTheme {
  /** Representative glow colour. */
  accent: string;
  /** CSS font-family stack. */
  font: string;
  upper?: boolean;
  tracking?: string;
  weight?: number;
}

const FALLBACK: EnvTheme = { accent: '#7ef9ff', font: 'system-ui, sans-serif' };

export const ENV_THEMES: Record<string, EnvTheme> = {
  floatingIslandsWorld: {
    accent: '#ff9ecb',
    font: '"Iowan Old Style", Palatino, Georgia, serif',
    tracking: '0.04em',
    weight: 400,
  },
  cyberpunkNightWorld: {
    accent: '#28e6ff',
    font: '"SF Mono", "JetBrains Mono", Consolas, ui-monospace, monospace',
    upper: true,
    tracking: '0.22em',
    weight: 500,
  },
  desertDreamWorld: {
    accent: '#ffbf7a',
    font: 'Baskerville, "Iowan Old Style", Georgia, serif',
    tracking: '0.14em',
    weight: 300,
  },
  underwaterAbyssWorld: {
    accent: '#8fe9ff',
    font: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
    tracking: '0.16em',
    weight: 300,
  },
  outerDimensionWorld: {
    accent: '#c79bff',
    font: 'Futura, "Century Gothic", "Trebuchet MS", sans-serif',
    upper: true,
    tracking: '0.34em',
    weight: 400,
  },
  ps2NightWorld: {
    accent: '#ffd39a',
    font: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
    tracking: '0.05em',
    weight: 400,
  },
  fantasyForestWorld: {
    accent: '#a8ffce',
    font: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
    tracking: '0.08em',
    weight: 400,
  },
  abstractVoidWorld: {
    accent: '#ff53d0',
    font: '"Helvetica Neue", Arial, system-ui, sans-serif',
    upper: true,
    tracking: '0.42em',
    weight: 700,
  },
  chaoticCarnivalWorld: {
    accent: '#ffd23f',
    font: 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif',
    upper: true,
    tracking: '0.08em',
    weight: 400,
  },
};

export function envTheme(id: string): EnvTheme {
  return ENV_THEMES[id] ?? FALLBACK;
}
