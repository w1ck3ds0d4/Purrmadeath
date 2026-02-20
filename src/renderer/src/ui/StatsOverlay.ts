import type { MetaStats } from '@shared/MetaStats';

/**
 * Full-screen overlay showing persistent player stats across all runs.
 * Created dynamically and appended to #overlay.
 */
export class StatsOverlay {
  private screen: HTMLElement;
  private content: HTMLElement;
  private onBack: (() => void) | null = null;

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'stats-screen';
    this.screen.style.display = 'none';

    const title = document.createElement('h2');
    title.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:30px;font-weight:700;color:#ccd8ea;letter-spacing:4px;margin-bottom:24px;user-select:none;";
    title.textContent = 'LIFETIME STATS';

    this.content = document.createElement('div');
    this.content.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:360px;max-height:60vh;overflow-y:auto;';

    const backBtn = document.createElement('button');
    backBtn.className = 'menu-btn muted';
    backBtn.style.cssText = 'margin-top:16px;width:360px;';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      this.hide();
      this.onBack?.();
    });

    this.screen.append(title, this.content, backBtn);
    document.getElementById('overlay')!.appendChild(this.screen);
  }

  show(stats: MetaStats, onBack: () => void): void {
    this.onBack = onBack;
    this.content.innerHTML = '';

    const rows: [string, string][] = [
      ['Total Runs', String(stats.totalRuns)],
      ['Waves Survived', String(stats.totalWavesSurvived)],
      ['Time Played', this.formatTime(stats.totalTimePlayed)],
      ['Enemies Killed', String(stats.totalEnemiesKilled)],
      ['Damage Dealt', this.formatNumber(stats.totalDamageDealt)],
      ['Buildings Built', String(stats.totalBuildingsBuilt)],
    ];

    // Resource row
    const rg = stats.resourcesGathered;
    rows.push(['Resources Gathered', `W:${rg.wood} S:${rg.stone} I:${rg.iron} D:${rg.diamond}`]);

    // Kill breakdown
    const killEntries = Object.entries(stats.killsByType).sort((a, b) => b[1] - a[1]);
    if (killEntries.length > 0) {
      rows.push(['', '']); // spacer
      rows.push(['KILLS BY TYPE', '']);
      for (const [type, count] of killEntries) {
        rows.push([`  ${type}`, String(count)]);
      }
    }

    for (const [label, value] of rows) {
      const row = document.createElement('div');
      if (!label && !value) {
        row.style.cssText = 'height:8px;';
      } else if (!value) {
        // Section header
        row.style.cssText = 'font-family:monospace;font-size:11px;color:#6a7a8a;letter-spacing:2px;padding:4px 0;user-select:none;';
        row.textContent = label;
      } else {
        row.style.cssText = 'display:flex;justify-content:space-between;font-family:monospace;font-size:14px;padding:6px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);';
        const labelEl = document.createElement('span');
        labelEl.style.color = '#8a9ab0';
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.style.color = '#ccd8ea';
        valueEl.textContent = value;
        row.append(labelEl, valueEl);
      }
      this.content.appendChild(row);
    }

    this.screen.style.display = 'flex';
  }

  hide(): void {
    this.screen.style.display = 'none';
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
}
