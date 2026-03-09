import type { CivilianPanelEntry, WorkableBuildingEntry } from '@shared/protocol';
import { THEME, panelStyle, titleStyle } from '../theme';

export interface CivilianPanelCallbacks {
  onAssign: (civilianId: number, buildingId: number | null) => void;
  onClose: () => void;
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  idle:       { label: 'Idle',       color: '#ccaa44' },
  working:    { label: 'Working',    color: '#44cc44' },
  fleeing:    { label: 'Fleeing',    color: '#ff4444' },
  wandering:  { label: 'Wandering',  color: '#ccaa44' },
  delivering: { label: 'Delivering', color: '#6699cc' },
  downed:     { label: 'Downed',     color: '#ff3333' },
};

const BUILDING_LABELS: Record<string, string> = {
  lumbermill: 'Lumbermill', quarry: 'Quarry', mine: 'Mine',
  farm: 'Farm', workshop: 'Workshop', repair_station: 'Repair Station',
  training_center: 'Training Center',
};

const BUILDING_CATEGORIES: Array<{ name: string; types: string[] }> = [
  { name: 'PRODUCTION', types: ['lumbermill', 'quarry', 'mine', 'farm', 'workshop'] },
  { name: 'MILITARY',   types: ['training_center'] },
  { name: 'UTILITY',    types: ['repair_station'] },
];

const RES_ICONS: Record<string, string> = {
  wood: '\u25A0', stone: '\u25A0', iron: '\u25A0', diamond: '\u25C6',
  food: '\u25A0', weapons: '\u25A0', repair: '\u2692',
};

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a', stone: '#999', iron: '#b08060', diamond: '#44ccdd',
  food: '#44aa44', weapons: '#cc6644', repair: '#6699cc',
};

/**
 * HoI4-inspired 2-column civilian management panel.
 * Left: civilian list. Right: production buildings with +/- assignment.
 */
export class CivilianPanelOverlay {
  private el: HTMLElement;
  private summaryEl: HTMLElement;
  private leftCol: HTMLElement;
  private rightCol: HTMLElement;
  private visible = false;
  private callbacks: CivilianPanelCallbacks | null = null;
  private civilians: CivilianPanelEntry[] = [];
  private buildings: WorkableBuildingEntry[] = [];
  private population = 0;
  private housingCapacity = 0;
  private nextSpawnSeconds = 0;

  constructor() {
    // Inject scrollbar styles
    const style = document.createElement('style');
    style.textContent = `
      .civ-panel-scroll::-webkit-scrollbar { width: 4px; }
      .civ-panel-scroll::-webkit-scrollbar-track { background: transparent; }
      .civ-panel-scroll::-webkit-scrollbar-thumb { background: ${THEME.accent}44; border-radius: 2px; }
    `;
    document.head.appendChild(style);

    this.el = document.createElement('div');
    this.el.id = 'civilian-panel-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'padding: 0',
      'display: none',
      'width: 720px',
      'max-width: 92vw',
      'max-height: 80vh',
      'user-select: none',
      'pointer-events: auto',
      'overflow: hidden',
      'display: none',
      'flex-direction: column',
    ].join('; ');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `padding: 12px 20px 8px; border-bottom: 1px solid ${THEME.borderSubtle};`;
    const title = document.createElement('div');
    title.style.cssText = titleStyle(14);
    title.textContent = 'CIVILIAN MANAGEMENT';
    titleBar.appendChild(title);
    this.el.appendChild(titleBar);

    // Summary bar
    this.summaryEl = document.createElement('div');
    this.summaryEl.style.cssText = `display: flex; justify-content: center; gap: 20px; padding: 6px 16px; font-size: 11px; color: ${THEME.textSecondary}; border-bottom: 1px solid ${THEME.borderSubtle};`;
    this.el.appendChild(this.summaryEl);

    // Body: 2 columns
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; flex: 1; min-height: 0;';

    // Left column: civilians
    this.leftCol = document.createElement('div');
    this.leftCol.className = 'civ-panel-scroll';
    this.leftCol.style.cssText = [
      'flex: 1',
      'min-width: 0',
      'overflow-y: auto',
      'padding: 8px 10px',
      `border-right: 1px solid ${THEME.borderSubtle}`,
      'max-height: 50vh',
    ].join('; ');
    body.appendChild(this.leftCol);

    // Right column: buildings
    this.rightCol = document.createElement('div');
    this.rightCol.className = 'civ-panel-scroll';
    this.rightCol.style.cssText = [
      'flex: 1',
      'min-width: 0',
      'overflow-y: auto',
      'padding: 8px 10px',
      'max-height: 50vh',
    ].join('; ');
    body.appendChild(this.rightCol);

    this.el.appendChild(body);

    // Footer hint
    const footer = document.createElement('div');
    footer.style.cssText = `padding: 6px 16px; border-top: 1px solid ${THEME.borderSubtle}; text-align: center; font-size: 10px; color: ${THEME.textDim};`;
    footer.textContent = '[+] assign idle civilian \u00B7 [-] unassign worker \u00B7 C / ESC to close';
    this.el.appendChild(footer);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  get isVisible(): boolean { return this.visible; }

  show(
    civilians: CivilianPanelEntry[],
    buildings: WorkableBuildingEntry[],
    population: number,
    housingCapacity: number,
    callbacks: CivilianPanelCallbacks,
  ): void {
    this.visible = true;
    this.callbacks = callbacks;
    this.civilians = civilians;
    this.buildings = buildings;
    this.population = population;
    this.housingCapacity = housingCapacity;
    this.el.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.callbacks?.onClose();
    this.callbacks = null;
  }

  update(
    civilians: CivilianPanelEntry[],
    buildings: WorkableBuildingEntry[],
    population: number,
    housingCapacity: number,
    nextSpawnSeconds = 0,
  ): void {
    this.civilians = civilians;
    this.buildings = buildings;
    this.population = population;
    this.housingCapacity = housingCapacity;
    this.nextSpawnSeconds = nextSpawnSeconds;
    if (this.visible) this.rebuild();
  }

  private rebuild(): void {
    this.renderSummary();
    this.renderCivilians();
    this.renderBuildings();
  }

  // ── Summary Bar ─────────────────────────────────────────────────────────

  private renderSummary(): void {
    const assignable = this.civilians.filter(c => (c.state === 'idle' || c.state === 'wandering') && !c.downed && c.assignedBuildingId === null);
    const working = this.civilians.filter(c => c.state === 'working').length;
    const emptySlots = this.buildings.filter(b => b.workerName === null).length;
    let spawnText = '';
    if (this.nextSpawnSeconds > 0) {
      spawnText = `Next spawn: ${Math.ceil(this.nextSpawnSeconds)}s`;
    } else if (this.population >= this.housingCapacity) {
      spawnText = 'At capacity';
    }

    this.summaryEl.innerHTML = '';
    const items = [
      { label: 'Population', value: `${this.population} / ${this.housingCapacity}`, color: THEME.textBright },
      { label: 'Working', value: String(working), color: '#44cc44' },
      { label: 'Idle', value: String(assignable.length), color: assignable.length > 0 ? '#ccaa44' : THEME.textMuted },
    ];
    if (spawnText) items.push({ label: '', value: spawnText, color: THEME.textSecondary });

    for (const item of items) {
      const el = document.createElement('span');
      el.style.cssText = `font-family: ${THEME.fontMono};`;
      if (item.label) {
        el.innerHTML = `<span style="color:${THEME.textMuted}">${item.label}:</span> <span style="color:${item.color};font-weight:bold">${item.value}</span>`;
      } else {
        el.style.color = item.color;
        el.textContent = item.value;
      }
      this.summaryEl.appendChild(el);
    }

    // Quick Assign button
    const canAutoAssign = assignable.length > 0 && emptySlots > 0;
    const autoCount = Math.min(assignable.length, emptySlots);
    const btn = document.createElement('button');
    btn.style.cssText = `background: ${canAutoAssign ? 'rgba(68,204,68,0.15)' : 'rgba(80,80,80,0.15)'}; border: 1px solid ${canAutoAssign ? 'rgba(68,204,68,0.4)' : 'rgba(80,80,80,0.3)'}; color: ${canAutoAssign ? '#6d6' : '#555'}; border-radius: 2px; padding: 2px 8px; font-size: 10px; font-weight: bold; cursor: ${canAutoAssign ? 'pointer' : 'default'}; font-family: ${THEME.fontMono};`;
    btn.textContent = `Auto-Assign (${autoCount})`;
    btn.title = canAutoAssign ? `Assign ${autoCount} idle civilians to empty building slots` : 'No idle civilians or no empty slots';
    if (canAutoAssign) {
      btn.addEventListener('click', () => {
        const emptyBuildings = this.buildings.filter(b => b.workerName === null);
        let assigned = 0;
        for (const bldg of emptyBuildings) {
          if (assigned >= assignable.length) break;
          this.callbacks?.onAssign(assignable[assigned].entityId, bldg.entityId);
          assigned++;
        }
      });
    }
    this.summaryEl.appendChild(btn);
  }

  // ── Left Column: Civilians ──────────────────────────────────────────────

  private renderCivilians(): void {
    this.leftCol.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `font-size: 10px; font-weight: bold; color: ${THEME.accent}; letter-spacing: 1.5px; margin-bottom: 6px;`;
    header.textContent = 'CIVILIANS';
    this.leftCol.appendChild(header);

    if (this.civilians.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `color: ${THEME.textMuted}; font-size: 11px; padding: 12px 0; text-align: center;`;
      empty.textContent = 'No civilians yet.';
      this.leftCol.appendChild(empty);
      return;
    }

    for (const civ of this.civilians) {
      const row = document.createElement('div');
      row.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 4px 6px; margin-bottom: 2px; background: ${THEME.surfaceBg}; border: 1px solid ${THEME.borderSubtle}; border-radius: 2px; font-size: 11px;`;

      // Name + specialty star
      const nameEl = document.createElement('span');
      nameEl.style.cssText = `font-weight: bold; color: ${THEME.accent}; min-width: 70px; font-size: 11px;`;
      if (civ.specialty) {
        nameEl.innerHTML = `${esc(civ.name)} <span style="color:#e8c96a;font-size:8px" title="Specialist">&#9733;</span>`;
      } else {
        nameEl.textContent = civ.name;
      }
      row.appendChild(nameEl);

      // State badge
      const displayState = civ.downed ? 'downed' : civ.state;
      const stateInfo = STATE_LABELS[displayState] ?? STATE_LABELS.idle;
      const stateEl = document.createElement('span');
      stateEl.style.cssText = `color: ${stateInfo.color}; min-width: 50px; font-size: 10px;`;
      stateEl.textContent = stateInfo.label;
      row.appendChild(stateEl);

      // HP text
      const hpPct = civ.maxHp > 0 ? civ.hp / civ.maxHp : 0;
      const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ddaa22' : '#cc3333';
      const hpEl = document.createElement('span');
      hpEl.style.cssText = `font-size: 10px; min-width: 55px;`;
      hpEl.innerHTML = `<span style="color:${THEME.textMuted}">HP:</span> <span style="color:${hpColor}">${civ.hp}/${civ.maxHp}</span>`;
      row.appendChild(hpEl);

      // Hunger text
      const hungerPct = Math.round(civ.hunger);
      const hungerColor = hungerPct < 50 ? '#44aa44' : hungerPct < 80 ? '#ddaa22' : '#cc3333';
      const hungerEl = document.createElement('span');
      hungerEl.style.cssText = `font-size: 10px; min-width: 55px;`;
      hungerEl.innerHTML = `<span style="color:${THEME.textMuted}">Hunger:</span> <span style="color:${hungerColor}">${hungerPct}%</span>`;
      row.appendChild(hungerEl);

      // Assignment label
      const assignEl = document.createElement('span');
      assignEl.style.cssText = `font-size: 9px; color: ${civ.assignedBuildingType ? '#7ac' : THEME.textMuted}; flex: 1; text-align: right;`;
      assignEl.textContent = civ.assignedBuildingType
        ? (BUILDING_LABELS[civ.assignedBuildingType] ?? civ.assignedBuildingType)
        : '';
      row.appendChild(assignEl);

      this.leftCol.appendChild(row);
    }
  }

  // ── Right Column: Buildings ─────────────────────────────────────────────

  private renderBuildings(): void {
    this.rightCol.innerHTML = '';

    // Group buildings by category
    for (const cat of BUILDING_CATEGORIES) {
      const catBuildings = this.buildings.filter(b => cat.types.includes(b.buildingType));
      if (catBuildings.length === 0) continue;

      // Category header
      const header = document.createElement('div');
      header.style.cssText = `font-size: 10px; font-weight: bold; color: ${THEME.accent}; letter-spacing: 1.5px; margin-bottom: 4px; margin-top: 6px;`;
      header.textContent = cat.name;
      this.rightCol.appendChild(header);

      for (const bldg of catBuildings) {
        const row = document.createElement('div');
        row.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 4px 6px; margin-bottom: 2px; background: ${THEME.surfaceBg}; border: 1px solid ${THEME.borderSubtle}; border-radius: 2px; font-size: 11px;`;

        // Building name + level
        const nameEl = document.createElement('span');
        nameEl.style.cssText = `font-weight: bold; color: #aac; min-width: 85px; font-size: 11px;`;
        const label = BUILDING_LABELS[bldg.buildingType] ?? bldg.buildingType;
        nameEl.textContent = bldg.level > 1 ? `${label} Lv.${bldg.level}` : label;
        row.appendChild(nameEl);

        // Production rate
        const rateEl = document.createElement('span');
        rateEl.style.cssText = 'min-width: 70px; font-size: 10px;';
        if (bldg.productionRate > 0 && bldg.resourceType) {
          const icon = RES_ICONS[bldg.resourceType] ?? '';
          const color = RES_COLORS[bldg.resourceType] ?? '#ccc';
          rateEl.innerHTML = `<span style="color:${color}">${icon}</span> <span style="color:#8ade8a">${bldg.productionRate.toFixed(1)}</span><span style="color:${THEME.textDim}">/tick</span>`;
        } else {
          rateEl.innerHTML = `<span style="color:${THEME.textMuted}">---</span>`;
        }
        row.appendChild(rateEl);

        // Worker slot indicator
        const slotEl = document.createElement('span');
        slotEl.style.cssText = 'display: flex; gap: 2px; align-items: center; min-width: 20px;';
        if (bldg.workerName) {
          // Filled slot (green square)
          const sq = document.createElement('span');
          sq.style.cssText = 'width: 10px; height: 10px; background: #44cc44; border-radius: 2px; display: inline-block;';
          sq.title = bldg.workerName;
          slotEl.appendChild(sq);
        } else {
          // Empty slot (dark square)
          const sq = document.createElement('span');
          sq.style.cssText = 'width: 10px; height: 10px; background: #333; border: 1px solid #555; border-radius: 2px; display: inline-block;';
          slotEl.appendChild(sq);
        }
        row.appendChild(slotEl);

        // + button (assign idle civilian)
        const plusBtn = document.createElement('button');
        const hasIdle = this.civilians.some(c => (c.state === 'idle' || c.state === 'wandering') && !c.downed && c.assignedBuildingId === null);
        const canAdd = bldg.workerName === null && hasIdle;
        plusBtn.style.cssText = `background: ${canAdd ? 'rgba(68,204,68,0.2)' : 'rgba(80,80,80,0.2)'}; border: 1px solid ${canAdd ? 'rgba(68,204,68,0.4)' : 'rgba(80,80,80,0.3)'}; color: ${canAdd ? '#6d6' : '#555'}; border-radius: 2px; padding: 0 5px; font-size: 12px; font-weight: bold; cursor: ${canAdd ? 'pointer' : 'default'}; line-height: 1.4;`;
        plusBtn.textContent = '+';
        plusBtn.title = canAdd ? 'Assign idle civilian' : (bldg.workerName ? 'Slot occupied' : 'No idle civilians');
        if (canAdd) {
          plusBtn.addEventListener('click', () => {
            // Find nearest idle civilian and assign
            const idle = this.civilians.find(c => (c.state === 'idle' || c.state === 'wandering') && !c.downed && c.assignedBuildingId === null);
            if (idle) this.callbacks?.onAssign(idle.entityId, bldg.entityId);
          });
        }
        row.appendChild(plusBtn);

        // - button (unassign worker)
        const minusBtn = document.createElement('button');
        const canRemove = bldg.workerName !== null;
        minusBtn.style.cssText = `background: ${canRemove ? 'rgba(200,50,50,0.2)' : 'rgba(80,80,80,0.2)'}; border: 1px solid ${canRemove ? 'rgba(200,50,50,0.4)' : 'rgba(80,80,80,0.3)'}; color: ${canRemove ? '#e88' : '#555'}; border-radius: 2px; padding: 0 5px; font-size: 12px; font-weight: bold; cursor: ${canRemove ? 'pointer' : 'default'}; line-height: 1.4;`;
        minusBtn.textContent = '-';
        minusBtn.title = canRemove ? `Unassign ${bldg.workerName}` : 'No worker assigned';
        if (canRemove) {
          minusBtn.addEventListener('click', () => {
            // Find the assigned civilian and unassign
            const worker = this.civilians.find(c => c.assignedBuildingId === bldg.entityId);
            if (worker) this.callbacks?.onAssign(worker.entityId, null);
          });
        }
        row.appendChild(minusBtn);

        this.rightCol.appendChild(row);
      }
    }

    // Show uncategorized buildings (if any new types aren't in categories)
    const categorized = new Set(BUILDING_CATEGORIES.flatMap(c => c.types));
    const uncategorized = this.buildings.filter(b => !categorized.has(b.buildingType));
    if (uncategorized.length > 0) {
      const header = document.createElement('div');
      header.style.cssText = `font-size: 10px; font-weight: bold; color: ${THEME.accent}; letter-spacing: 1.5px; margin-bottom: 4px; margin-top: 6px;`;
      header.textContent = 'OTHER';
      this.rightCol.appendChild(header);
      for (const bldg of uncategorized) {
        const row = document.createElement('div');
        row.style.cssText = `padding: 4px 6px; margin-bottom: 2px; background: ${THEME.surfaceBg}; border: 1px solid ${THEME.borderSubtle}; border-radius: 2px; font-size: 11px; color: ${THEME.textMuted};`;
        row.textContent = BUILDING_LABELS[bldg.buildingType] ?? bldg.buildingType;
        this.rightCol.appendChild(row);
      }
    }
  }
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
