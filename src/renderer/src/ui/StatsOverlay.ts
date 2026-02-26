import type { MetaStats } from '@shared/MetaStats';
import { ACHIEVEMENTS, CATEGORY_ORDER, CATEGORY_LABELS } from '@shared/ProgressionDefinitions';
import type { AchievementCategory } from '@shared/ProgressionDefinitions';

const CATEGORY_COLORS: Record<AchievementCategory, string> = {
  class: '#cc9966',
  buff: '#55cc77',
  building: '#7799cc',
  ability: '#9966dd',
};

/**
 * Full-screen Progression overlay with two columns:
 *   Left  — lifetime global stats
 *   Right — achievements grouped by category with progress bars
 */
export class StatsOverlay {
  private screen: HTMLElement;
  private leftCol: HTMLElement;
  private rightCol: HTMLElement;
  private onBack: (() => void) | null = null;

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'stats-screen';
    this.screen.style.display = 'none';

    // Title
    const title = document.createElement('h2');
    title.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:30px;font-weight:700;color:#ccd8ea;letter-spacing:4px;margin-bottom:20px;user-select:none;";
    title.textContent = 'PROGRESSION';

    // Two-column container
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;gap:32px;width:820px;max-height:65vh;';

    // Left column — stats
    this.leftCol = document.createElement('div');
    this.leftCol.style.cssText = 'flex:0 0 300px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;padding-right:8px;';

    // Right column — achievements
    this.rightCol = document.createElement('div');
    this.rightCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;overflow-y:auto;padding-right:4px;';

    container.append(this.leftCol, this.rightCol);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'menu-btn muted';
    backBtn.style.cssText = 'margin-top:16px;width:200px;';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      this.hide();
      this.onBack?.();
    });

    this.screen.append(title, container, backBtn);
    document.getElementById('overlay')!.appendChild(this.screen);
  }

  show(stats: MetaStats, onBack: () => void): void {
    this.onBack = onBack;
    this.renderStats(stats);
    this.renderAchievements(stats);
    this.screen.style.display = 'flex';
  }

  hide(): void {
    this.screen.style.display = 'none';
  }

  // ── Left column: stats ─────────────────────────────────────────────────

  private renderStats(stats: MetaStats): void {
    this.leftCol.innerHTML = '';

    this.addSectionHeader(this.leftCol, 'LIFETIME STATS');

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
      this.leftCol.appendChild(this.makeStatRow(label, value));
    }

    // Resource breakdown
    this.addSpacer(this.leftCol);
    this.addSectionHeader(this.leftCol, 'RESOURCES');
    const resRows: [string, string, string][] = [
      ['Wood', String(rg.wood), '#8B6914'],
      ['Stone', String(rg.stone), '#7a8899'],
      ['Iron', String(rg.iron), '#99aabb'],
      ['Diamond', String(rg.diamond), '#66ccdd'],
    ];
    for (const [label, value, color] of resRows) {
      const row = this.makeStatRow(label, value);
      (row.firstChild as HTMLElement).style.color = color;
      this.leftCol.appendChild(row);
    }

    // Kill breakdown (top 5)
    const killEntries = Object.entries(stats.killsByType).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (killEntries.length > 0) {
      this.addSpacer(this.leftCol);
      this.addSectionHeader(this.leftCol, 'TOP KILLS');
      for (const [type, count] of killEntries) {
        this.leftCol.appendChild(this.makeStatRow(type, String(count)));
      }
    }
  }

  // ── Right column: achievements ─────────────────────────────────────────

  private renderAchievements(stats: MetaStats): void {
    this.rightCol.innerHTML = '';

    for (const cat of CATEGORY_ORDER) {
      const achievements = ACHIEVEMENTS.filter(a => a.category === cat);
      if (achievements.length === 0) continue;

      this.addSectionHeader(this.rightCol, CATEGORY_LABELS[cat].toUpperCase(), CATEGORY_COLORS[cat]);

      for (const ach of achievements) {
        const current = Math.min(ach.progress(stats), ach.target);
        const done = current >= ach.target;
        this.rightCol.appendChild(this.makeAchievementRow(ach.displayName, ach.description, ach.reward, current, ach.target, done, CATEGORY_COLORS[cat]));
      }

      this.addSpacer(this.rightCol);
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────

  private makeStatRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;font-family:monospace;font-size:13px;padding:5px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);';
    const lbl = document.createElement('span');
    lbl.style.color = '#7a8a9a';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.style.color = '#ccd8ea';
    val.textContent = value;
    row.append(lbl, val);
    return row;
  }

  private makeAchievementRow(
    name: string, desc: string, reward: string,
    current: number, target: number, done: boolean, color: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;flex-direction:column;gap:3px;padding:8px 10px;background:rgba(255,255,255,${done ? '0.07' : '0.03'});border:1px solid rgba(255,255,255,${done ? '0.12' : '0.06'});`;

    // Top line: name + reward
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const nameEl = document.createElement('span');
    nameEl.style.cssText = `font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:${done ? color : '#8a9ab0'};`;
    nameEl.textContent = done ? `\u2713 ${name}` : name;
    const rewardEl = document.createElement('span');
    rewardEl.style.cssText = `font-family:monospace;font-size:11px;color:${done ? '#aabb99' : '#556644'};`;
    rewardEl.textContent = reward;
    top.append(nameEl, rewardEl);

    // Description
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-family:monospace;font-size:11px;color:#556677;';
    descEl.textContent = desc;

    // Progress bar
    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'width:100%;height:4px;background:rgba(255,255,255,0.06);margin-top:2px;';
    const barInner = document.createElement('div');
    const pct = Math.min(current / target * 100, 100);
    barInner.style.cssText = `width:${pct}%;height:100%;background:${done ? color : 'rgba(255,255,255,0.15)'};transition:width 0.3s;`;
    barOuter.appendChild(barInner);

    // Progress text
    const progText = document.createElement('div');
    progText.style.cssText = `font-family:monospace;font-size:10px;color:${done ? '#7a9a6a' : '#4a5a6a'};text-align:right;`;
    progText.textContent = done ? 'Complete' : `${this.formatNumber(current)} / ${this.formatNumber(target)}`;

    row.append(top, descEl, barOuter, progText);
    return row;
  }

  private addSectionHeader(container: HTMLElement, text: string, color = '#5a6a7a'): void {
    const header = document.createElement('div');
    header.style.cssText = `font-family:'Segoe UI',sans-serif;font-size:11px;font-weight:600;color:${color};letter-spacing:2px;padding:6px 0 2px;user-select:none;`;
    header.textContent = text;
    container.appendChild(header);
  }

  private addSpacer(container: HTMLElement): void {
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
}
