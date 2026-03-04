/**
 * Unified dark medieval crimson UI theme.
 * All overlays and HUDs import from here instead of hardcoding colors.
 */
export const THEME = {
  // -- Backgrounds (dark stone with faint red warmth) --
  panelBg:      'rgba(10, 4, 6, 0.92)',
  panelBgLight: 'rgba(10, 4, 6, 0.75)',
  surfaceBg:    'rgba(180, 40, 40, 0.06)',
  surfaceHover: 'rgba(180, 40, 40, 0.12)',

  // -- Accents (aged blood crimson) --
  accent:       '#aa2233',
  accentHex:    0xaa2233,
  accentBright: '#cc4444',
  accentRgba:   (a: number) => `rgba(170, 34, 51, ${a})`,

  // -- Borders --
  borderSubtle:  'rgba(255, 255, 255, 0.06)',
  borderDefault: 'rgba(170, 34, 51, 0.25)',
  borderHover:   'rgba(200, 60, 60, 0.5)',
  borderAccent:  'rgba(170, 34, 51, 0.35)',

  // -- Border radius --
  radiusSm: '4px',
  radiusMd: '6px',
  radiusLg: '8px',

  // -- Backdrop filter --
  blurHeavy: 'blur(6px)',
  blurLight: 'blur(4px)',

  // -- Fonts --
  fontUI:   "'Segoe UI', monospace",
  fontMono: 'monospace',

  // -- Text (aged parchment tones) --
  textPrimary:   '#d4c4b8',
  textBright:    '#e8d8cc',
  textSecondary: '#9a8a7e',
  textMuted:     '#7a6a60',
  textDim:       '#5a4a44',

  // -- Panel glow (dying embers) --
  panelGlow: '0 0 20px rgba(120, 20, 30, 0.15)',

  // -- Transitions --
  transition: '0.15s',
};

/** Full panel base style (modals, centered overlays). */
export function panelStyle(): string {
  return [
    `background: ${THEME.panelBg}`,
    `backdrop-filter: ${THEME.blurHeavy}`,
    `border: 1px solid ${THEME.borderAccent}`,
    `border-radius: ${THEME.radiusLg}`,
    `font-family: ${THEME.fontUI}`,
    'font-size: 13px',
    `color: ${THEME.textPrimary}`,
    `box-shadow: ${THEME.panelGlow}`,
  ].join('; ');
}

/** Lighter panel style for HUD elements. */
export function hudStyle(): string {
  return [
    `background: ${THEME.panelBgLight}`,
    `backdrop-filter: ${THEME.blurLight}`,
    `font-family: ${THEME.fontUI}`,
    'font-size: 12px',
    `color: ${THEME.textPrimary}`,
  ].join('; ');
}

/** Standard title text style. */
export function titleStyle(fontSize = 16): string {
  return [
    'font-weight: bold',
    `font-size: ${fontSize}px`,
    `color: ${THEME.accent}`,
    'text-align: center',
    'letter-spacing: 2px',
    'text-transform: uppercase',
  ].join('; ');
}

/** Standard hint/footer text style. */
export function hintStyle(): string {
  return `font-size: 11px; color: ${THEME.textMuted}; text-align: center;`;
}

/** Standard button style with optional custom accent. */
export function buttonStyle(accent?: string): string {
  const c = accent ?? THEME.accent;
  return [
    `background: ${THEME.surfaceBg}`,
    `border: 1px solid ${c}66`,
    `border-radius: ${THEME.radiusSm}`,
    'padding: 3px 10px',
    `color: ${c}`,
    'font-size: 12px',
    'cursor: pointer',
    `font-family: ${THEME.fontUI}`,
    `transition: background ${THEME.transition}`,
  ].join('; ');
}
