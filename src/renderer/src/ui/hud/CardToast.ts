// ---------------------------------------------------------------------------
// CardToast - slide-in notification when a card is picked up
// ---------------------------------------------------------------------------

const RARITY_COLORS: Record<string, string> = {
  common:    '#b4b4b4',
  rare:      '#4a90d9',
  epic:      '#aa44ff',
  legendary: '#e8c96a',
};

const TOAST_DURATION = 4; // seconds visible
const SLIDE_IN = 0.3;     // seconds for slide animation
const FADE_OUT = 0.5;     // seconds for fade out

interface ToastEntry {
  el: HTMLDivElement;
  timer: number;
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

  function show(displayName: string, cardName: string, rarity: string): void {
    const color = RARITY_COLORS[rarity] ?? '#cccccc';

    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(0,0,0,0.85);
      border-left: 4px solid ${color};
      border-radius: 4px;
      padding: 8px 14px;
      font-family: monospace;
      font-size: 13px;
      color: #eee;
      transform: translateX(120%);
      transition: transform ${SLIDE_IN}s ease-out, opacity ${FADE_OUT}s ease-in;
      white-space: nowrap;
    `;
    el.innerHTML = `
      <span style="color:#aaa">${displayName}</span>
      <span style="color:#888"> found </span>
      <span style="color:${color}; font-weight:bold">${cardName}</span>
      <span style="color:${color}; font-size:11px; opacity:0.7"> (${rarity})</span>
    `;

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
