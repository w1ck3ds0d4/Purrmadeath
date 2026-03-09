import type { MetaStats } from '@shared/definitions/MetaStats';
import { ACHIEVEMENTS, CATEGORY_ORDER, CATEGORY_LABELS } from '@shared/definitions/ProgressionDefinitions';
import type { Achievement, AchievementCategory } from '@shared/definitions/ProgressionDefinitions';
import { THEME } from '../theme';

const CATEGORY_COLORS: Record<AchievementCategory, string> = {
  class: '#cc9966',
  buff: '#55cc77',
  building: '#7799cc',
};

/**
 * Full-screen Progression overlay matching the lobby layout:
 *   Left sidebar  - lifetime stats (fixed width)
 *   Right area    - medal grid grouped by category with hover tooltips
 */
export class StatsOverlay {
  private screen: HTMLElement;
  private leftCol: HTMLElement;
  private rightCol: HTMLElement;
  private tooltip: HTMLElement;
  private confirmDialog: HTMLElement;
  private onBack: (() => void) | null = null;
  private onReset: (() => void) | null = null;

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'stats-screen';
    this.screen.style.display = 'none';

    // Full-height layout (like lobby-layout)
    const layout = document.createElement('div');
    layout.style.cssText = 'display:flex;flex:1;min-height:0;width:100%;';

    // Left sidebar - stats
    this.leftCol = document.createElement('div');
    this.leftCol.style.cssText = [
      'width:300px',
      'flex-shrink:0',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:28px 24px',
      `border-right:1px solid ${THEME.borderSubtle}`,
      'overflow-y:auto',
    ].join(';');

    // Right area - medals
    this.rightCol = document.createElement('div');
    this.rightCol.style.cssText = [
      'flex:1',
      'display:flex',
      'flex-direction:column',
      'gap:20px',
      'padding:28px 32px',
      'overflow-y:auto',
      'position:relative',
      'align-items:flex-start',
    ].join(';');

    layout.append(this.leftCol, this.rightCol);

    // Shared tooltip (hidden by default)
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = [
      'position:absolute',
      'z-index:100',
      `background:${THEME.panelBg}`,
      `backdrop-filter:${THEME.blurHeavy}`,
      `border:1px solid ${THEME.borderDefault}`,
      `border-radius:${THEME.radiusMd}`,
      'padding:10px 14px',
      `font-family:${THEME.fontUI}`,
      'font-size:12px',
      `color:${THEME.textPrimary}`,
      'pointer-events:none',
      'display:none',
      'min-width:180px',
      'max-width:220px',
      'white-space:normal',
    ].join(';');
    this.rightCol.appendChild(this.tooltip);

    // Bottom buttons container (pushed to bottom of left sidebar)
    const bottomBtns = document.createElement('div');
    bottomBtns.style.cssText = 'margin-top:auto;display:flex;flex-direction:column;gap:6px;';

    // Reset Progress button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'menu-btn';
    resetBtn.style.cssText = `width:100%;background:rgba(200,50,50,0.15);border:1px solid rgba(200,50,50,0.3);color:#e88;font-size:11px;`;
    resetBtn.textContent = 'Reset Progress';
    resetBtn.addEventListener('click', () => {
      this.confirmDialog.style.display = 'flex';
    });
    bottomBtns.appendChild(resetBtn);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'menu-btn muted';
    backBtn.style.cssText = 'width:100%;';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      this.hide();
      this.onBack?.();
    });
    bottomBtns.appendChild(backBtn);
    this.leftCol.appendChild(bottomBtns);

    // Confirmation dialog (centered overlay)
    this.confirmDialog = document.createElement('div');
    this.confirmDialog.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'justify-content:center',
      'align-items:center',
      'background:rgba(0,0,0,0.6)',
    ].join(';');

    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = [
      `background:${THEME.panelBg}`,
      `border:1px solid ${THEME.borderAccent}`,
      `border-radius:${THEME.radiusMd}`,
      'padding:24px 32px',
      'text-align:center',
      'min-width:300px',
    ].join(';');

    const dialogTitle = document.createElement('div');
    dialogTitle.style.cssText = `font-size:16px;font-weight:bold;color:#e88;margin-bottom:12px;font-family:${THEME.fontUI};`;
    dialogTitle.textContent = 'Reset Progress?';
    dialogBox.appendChild(dialogTitle);

    const dialogText = document.createElement('div');
    dialogText.style.cssText = `font-size:12px;color:${THEME.textSecondary};margin-bottom:20px;line-height:1.5;`;
    dialogText.textContent = 'This will permanently reset all stats, achievements, and unlocks. This cannot be undone.';
    dialogBox.appendChild(dialogText);

    const dialogBtns = document.createElement('div');
    dialogBtns.style.cssText = 'display:flex;gap:12px;justify-content:center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'menu-btn muted';
    cancelBtn.style.cssText = 'min-width:100px;';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { this.confirmDialog.style.display = 'none'; });
    dialogBtns.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'menu-btn';
    confirmBtn.style.cssText = 'min-width:100px;background:rgba(200,50,50,0.3);border:1px solid rgba(200,50,50,0.5);color:#f66;';
    confirmBtn.textContent = 'Reset';
    confirmBtn.addEventListener('click', () => {
      this.confirmDialog.style.display = 'none';
      this.onReset?.();
      this.hide();
      this.onBack?.();
    });
    dialogBtns.appendChild(confirmBtn);

    dialogBox.appendChild(dialogBtns);
    this.confirmDialog.appendChild(dialogBox);
    document.body.appendChild(this.confirmDialog);

    this.screen.appendChild(layout);
    document.getElementById('overlay')!.appendChild(this.screen);

    // ESC to go back
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.screen.style.display !== 'none') {
        this.hide();
        this.onBack?.();
        e.stopPropagation();
      }
    });
  }

  show(stats: MetaStats, onBack: () => void, onReset?: () => void): void {
    this.onBack = onBack;
    this.onReset = onReset ?? null;
    this.renderStats(stats);
    this.renderMedals(stats);
    this.screen.style.display = 'flex';
  }

  hide(): void {
    this.screen.style.display = 'none';
    this.tooltip.style.display = 'none';
    this.confirmDialog.style.display = 'none';
  }

  // ── Left column: stats ─────────────────────────────────────────────────

  private renderStats(stats: MetaStats): void {
    // Keep the bottom buttons container (last child), remove everything else
    while (this.leftCol.children.length > 1) {
      this.leftCol.removeChild(this.leftCol.firstChild!);
    }

    const frag = document.createDocumentFragment();

    this.addSectionHeader(frag, 'LIFETIME STATS');

    const rows: [string, string][] = [
      ['Total Runs', String(stats.totalRuns)],
      ['Highest Wave', String(stats.highestWaveSurvived)],
      ['Waves Survived', String(stats.totalWavesSurvived)],
      ['Time Played', this.formatTime(stats.totalTimePlayed)],
      ['Enemies Killed', this.formatNumber(stats.totalEnemiesKilled)],
      ['Damage Dealt', this.formatNumber(stats.totalDamageDealt)],
      ['Buildings Built', String(stats.totalBuildingsBuilt)],
    ];

    const rg = stats.resourcesGathered;
    const totalRes = rg.wood + rg.stone + rg.iron + rg.diamond;
    rows.push(['Resources', this.formatNumber(totalRes)]);

    for (const [label, value] of rows) {
      frag.appendChild(this.makeStatRow(label, value));
    }

    // Resource breakdown
    this.addSpacer(frag);
    this.addSectionHeader(frag, 'RESOURCES');
    const resRows: [string, string, string][] = [
      ['Wood', String(rg.wood), '#8B6914'],
      ['Stone', String(rg.stone), '#7a8899'],
      ['Iron', String(rg.iron), '#99aabb'],
      ['Diamond', String(rg.diamond), '#66ccdd'],
    ];
    for (const [label, value, color] of resRows) {
      const row = this.makeStatRow(label, value);
      (row.firstChild as HTMLElement).style.color = color;
      frag.appendChild(row);
    }

    // Kill breakdown (top 5)
    const killEntries = Object.entries(stats.killsByType).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (killEntries.length > 0) {
      this.addSpacer(frag);
      this.addSectionHeader(frag, 'TOP KILLS');
      for (const [type, count] of killEntries) {
        frag.appendChild(this.makeStatRow(type, String(count)));
      }
    }

    // Insert before back button
    this.leftCol.insertBefore(frag, this.leftCol.lastChild);
  }

  // ── Right column: medal grid ────────────────────────────────────────────

  private renderMedals(stats: MetaStats): void {
    // Clear everything except the tooltip
    const children = Array.from(this.rightCol.children);
    for (const child of children) {
      if (child !== this.tooltip) this.rightCol.removeChild(child);
    }

    // Title
    const title = document.createElement('div');
    title.style.cssText = `font-family:${THEME.fontUI};font-size:26px;font-weight:700;color:${THEME.textPrimary};letter-spacing:4px;margin-bottom:8px;user-select:none;`;
    title.textContent = 'PROGRESSION';
    this.rightCol.appendChild(title);

    for (const cat of CATEGORY_ORDER) {
      const achievements = ACHIEVEMENTS.filter(a => a.category === cat);
      if (achievements.length === 0) continue;

      // Category label
      this.addSectionHeader(this.rightCol, CATEGORY_LABELS[cat].toUpperCase(), CATEGORY_COLORS[cat]);

      // Medal row - completed first, then locked
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:24px;';

      const sorted = achievements
        .map(ach => ({ ach, current: Math.min(ach.progress(stats), ach.target), done: ach.progress(stats) >= ach.target }))
        .sort((a, b) => (a.done === b.done ? 0 : a.done ? -1 : 1));

      for (const { ach, current, done } of sorted) {
        row.appendChild(this.makeMedal(ach, current, done));
      }

      this.rightCol.appendChild(row);
    }
  }

  private makeMedal(ach: Achievement, current: number, done: boolean): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;';

    // Circle
    const circle = document.createElement('div');
    if (done) {
      circle.style.cssText = [
        'width:80px;height:80px;border-radius:50%',
        `background:${ach.medalColor}`,
        `border:3px solid ${this.lighten(ach.medalColor, 0.3)}`,
        `box-shadow:0 0 14px ${ach.medalColor}60`,
        'display:flex;align-items:center;justify-content:center',
        `transition:transform ${THEME.transition},box-shadow ${THEME.transition}`,
      ].join(';');
      const check = document.createElement('span');
      check.style.cssText = 'font-size:30px;color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.4);';
      check.textContent = '\u2713';
      circle.appendChild(check);
    } else {
      circle.style.cssText = [
        'width:80px;height:80px;border-radius:50%',
        'background:rgba(255,255,255,0.06)',
        'border:3px solid rgba(255,255,255,0.1)',
        'display:flex;align-items:center;justify-content:center',
        `transition:transform ${THEME.transition},border-color ${THEME.transition}`,
      ].join(';');
      const qmark = document.createElement('span');
      qmark.style.cssText = 'font-size:28px;color:rgba(255,255,255,0.2);font-weight:bold;';
      qmark.textContent = '?';
      circle.appendChild(qmark);
    }

    // Label
    const label = document.createElement('div');
    label.style.cssText = `font-family:${THEME.fontUI};font-size:12px;text-align:center;max-width:90px;line-height:1.2;color:${done ? ach.medalColor : '#556677'};`;
    label.textContent = ach.displayName;

    wrapper.append(circle, label);

    // Hover interactions
    wrapper.addEventListener('mouseenter', (e) => {
      circle.style.transform = 'scale(1.1)';
      if (done) {
        circle.style.boxShadow = `0 0 20px ${ach.medalColor}90`;
      } else {
        circle.style.borderColor = 'rgba(255,255,255,0.25)';
      }
      this.showTooltip(ach, current, done, wrapper, e);
    });
    wrapper.addEventListener('mouseleave', () => {
      circle.style.transform = 'scale(1)';
      if (done) {
        circle.style.boxShadow = `0 0 14px ${ach.medalColor}60`;
      } else {
        circle.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      this.tooltip.style.display = 'none';
    });

    return wrapper;
  }

  private showTooltip(ach: Achievement, current: number, done: boolean, anchor: HTMLElement, _e: MouseEvent): void {
    const pct = Math.min(current / ach.target * 100, 100);
    const barColor = done ? ach.medalColor : 'rgba(255,255,255,0.2)';

    this.tooltip.innerHTML = '';

    // Name
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-weight:bold;font-size:13px;color:${done ? ach.medalColor : THEME.textSecondary};margin-bottom:4px;`;
    nameEl.textContent = ach.displayName;

    // Description
    const descEl = document.createElement('div');
    descEl.style.cssText = `font-size:11px;color:${THEME.textMuted};margin-bottom:6px;`;
    descEl.textContent = ach.description;

    // Progress bar
    const barOuter = document.createElement('div');
    barOuter.style.cssText = `width:100%;height:5px;background:${THEME.borderSubtle};border-radius:3px;overflow:hidden;`;
    const barInner = document.createElement('div');
    barInner.style.cssText = `width:${pct}%;height:100%;background:${barColor};border-radius:3px;`;
    barOuter.appendChild(barInner);

    // Progress text
    const progEl = document.createElement('div');
    progEl.style.cssText = `font-size:10px;color:${done ? '#7a9a6a' : THEME.textDim};text-align:right;margin-top:2px;`;
    progEl.textContent = done ? 'Complete' : `${this.formatNumber(current)} / ${this.formatNumber(ach.target)}`;

    // Reward
    const rewardEl = document.createElement('div');
    rewardEl.style.cssText = `font-size:11px;color:${done ? '#aabb99' : '#556644'};margin-top:6px;border-top:1px solid rgba(255,255,255,0.08);padding-top:5px;`;
    rewardEl.textContent = ach.reward;

    this.tooltip.append(nameEl, descEl, barOuter, progEl, rewardEl);

    // Position tooltip below the medal
    const anchorRect = anchor.getBoundingClientRect();
    const parentRect = this.rightCol.getBoundingClientRect();
    const left = anchorRect.left - parentRect.left + this.rightCol.scrollLeft;
    const top = anchorRect.bottom - parentRect.top + this.rightCol.scrollTop + 6;

    this.tooltip.style.left = `${Math.max(0, Math.min(left, parentRect.width - 230))}px`;
    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.display = 'block';
  }

  // ── DOM helpers ────────────────────────────────────────────────────────

  private makeStatRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;justify-content:space-between;font-family:${THEME.fontMono};font-size:13px;padding:5px 10px;background:${THEME.surfaceBg};border:1px solid ${THEME.borderSubtle};`;
    const lbl = document.createElement('span');
    lbl.style.color = THEME.textMuted;
    lbl.textContent = label;
    const val = document.createElement('span');
    val.style.color = THEME.textPrimary;
    val.textContent = value;
    row.append(lbl, val);
    return row;
  }

  private addSectionHeader(container: HTMLElement | DocumentFragment, text: string, color = THEME.textDim): void {
    const header = document.createElement('div');
    header.style.cssText = `font-family:${THEME.fontUI};font-size:12px;font-weight:600;color:${color};letter-spacing:2px;padding:6px 0 2px;user-select:none;`;
    header.textContent = text;
    container.appendChild(header);
  }

  private addSpacer(container: HTMLElement | DocumentFragment): void {
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:6px;';
    container.appendChild(spacer);
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  private formatNumber(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  /** Lighten a hex color by a factor (0-1). */
  private lighten(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lr = Math.min(255, Math.round(r + (255 - r) * factor));
    const lg = Math.min(255, Math.round(g + (255 - g) * factor));
    const lb = Math.min(255, Math.round(b + (255 - b) * factor));
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  }
}
