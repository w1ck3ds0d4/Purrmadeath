// ---------------------------------------------------------------------------
// NotificationToast - slide-in popup for system notifications
// ---------------------------------------------------------------------------

import { THEME } from '../theme';

/** Notification severity determines the left-border accent color. */
export type NotifLevel = 'info' | 'warning' | 'danger' | 'success' | 'boss';

const LEVEL_COLORS: Record<NotifLevel, string> = {
  info:    THEME.accent,
  warning: '#ddaa22',
  danger:  '#cc4444',
  success: '#44aa44',
  boss:    '#aa44ff',
};

const TOAST_DURATION = 4;   // seconds visible
const SLIDE_IN = 0.3;       // seconds for slide animation
const FADE_OUT = 0.5;       // seconds for fade out

interface ToastEntry {
  el: HTMLDivElement;
  timer: number;
}

function makeSpan(text: string, style: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = style;
  span.textContent = text;
  return span;
}

export function createNotificationToast() {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; left: 50%; top: 80px; z-index: 200;
    transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 6px;
    pointer-events: none; align-items: center;
  `;
  document.getElementById('overlay')?.appendChild(container);

  const toasts: ToastEntry[] = [];

  function show(text: string, level: NotifLevel = 'info', subtitle?: string): void {
    const color = LEVEL_COLORS[level];

    const el = document.createElement('div');
    el.style.cssText = `
      background: ${THEME.panelBg};
      border-left: 4px solid ${color};
      border-radius: ${THEME.radiusSm};
      padding: 8px 16px;
      font-family: ${THEME.fontUI};
      font-size: 13px;
      color: ${THEME.textBright};
      transform: translateY(-20px);
      opacity: 0;
      transition: transform ${SLIDE_IN}s ease-out, opacity ${SLIDE_IN}s ease-out;
      white-space: nowrap;
      max-width: 450px;
      backdrop-filter: ${THEME.blurHeavy};
      box-shadow: ${THEME.panelGlow};
    `;

    el.appendChild(makeSpan(text, `color:${color}; font-weight:bold`));

    if (subtitle) {
      el.appendChild(document.createElement('br'));
      el.appendChild(makeSpan(subtitle, `color:${THEME.textSecondary}; font-size:11px; white-space:normal`));
    }

    container.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    });

    toasts.push({ el, timer: TOAST_DURATION });
  }

  function update(dt: number): void {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.timer -= dt;
      if (t.timer <= FADE_OUT && t.el.style.opacity !== '0') {
        t.el.style.opacity = '0';
        t.el.style.transform = 'translateY(-10px)';
      }
      if (t.timer <= 0) {
        container.removeChild(t.el);
        toasts.splice(i, 1);
      }
    }
  }

  function hide(): void {
    for (const t of toasts) container.removeChild(t.el);
    toasts.length = 0;
  }

  function destroy(): void {
    hide();
    container.remove();
  }

  return { show, update, hide, destroy };
}

export type NotificationToast = ReturnType<typeof createNotificationToast>;
