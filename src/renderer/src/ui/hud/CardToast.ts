// ---------------------------------------------------------------------------
// CardToast - slide-in notification when a card is auto-granted
// ---------------------------------------------------------------------------

const RARITY_COLORS: Record<string, string> = {
  common:    '#b4b4b4',
  rare:      '#4a90d9',
  epic:      '#aa44ff',
  legendary: '#e8c96a',
};

const CATEGORY_COLORS: Record<string, string> = {
  buff:     '#4a90d9',
  ability:  '#aa44ff',
  resource: '#66aa66',
  curse:    '#cc6633',
};

const TOAST_DURATION = 5; // seconds visible (increased for auto-grant)
const SLIDE_IN = 0.3;     // seconds for slide animation
const FADE_OUT = 0.5;     // seconds for fade out

interface ToastEntry {
  el: HTMLDivElement;
  timer: number;
}

/** Create a styled span with textContent (safe from XSS). */
function makeSpan(text: string, style: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = style;
  span.textContent = text;
  return span;
}

export function createCardToast() {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; right: 16px; top: 100px; z-index: 200;
    display: flex; flex-direction: column; gap: 6px;
    pointer-events: none;
  `;
  document.getElementById('overlay')?.appendChild(container);

  const toasts: ToastEntry[] = [];

  function show(displayName: string, cardName: string, rarity: string, category?: string, description?: string): void {
    const color = RARITY_COLORS[rarity] ?? '#cccccc';
    const catColor = CATEGORY_COLORS[category ?? 'buff'] ?? '#cccccc';
    const isCurse = category === 'curse';

    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(0,0,0,0.85);
      border-left: 4px solid ${isCurse ? catColor : color};
      border-radius: 4px;
      padding: 8px 14px;
      font-family: monospace;
      font-size: 13px;
      color: #eee;
      transform: translateX(120%);
      transition: transform ${SLIDE_IN}s ease-out, opacity ${FADE_OUT}s ease-in;
      white-space: nowrap;
      max-width: 350px;
    `;

    // Build content safely using DOM APIs (no innerHTML)
    el.appendChild(makeSpan(displayName, 'color:#aaa'));
    el.appendChild(makeSpan(' got ', 'color:#888'));
    el.appendChild(makeSpan(cardName, `color:${color}; font-weight:bold`));
    el.appendChild(makeSpan(` (${rarity})`, `color:${color}; font-size:11px; opacity:0.7`));

    // Show category tag for curses
    if (isCurse) {
      el.appendChild(document.createElement('br'));
      el.appendChild(makeSpan('CURSE', `color:${catColor}; font-size:11px; font-weight:bold`));
    }

    // Show description if provided
    if (description) {
      el.appendChild(document.createElement('br'));
      el.appendChild(makeSpan(description, 'color:#999; font-size:11px; white-space:normal'));
    }

    container.appendChild(el);
    // Trigger slide-in
    requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });

    toasts.push({ el, timer: TOAST_DURATION });
  }

  function update(dt: number): void {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.timer -= dt;
      if (t.timer <= FADE_OUT && t.el.style.opacity !== '0') {
        t.el.style.opacity = '0';
      }
      if (t.timer <= 0) {
        container.removeChild(t.el);
        toasts.splice(i, 1);
      }
    }
  }

  function hide(): void {
    for (const t of toasts) {
      container.removeChild(t.el);
    }
    toasts.length = 0;
  }

  function destroy(): void {
    hide();
    container.remove();
  }

  return { show, update, hide, destroy };
}

export type CardToast = ReturnType<typeof createCardToast>;
