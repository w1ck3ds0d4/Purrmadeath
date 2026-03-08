import type { CivilianPanelEntry, WorkableBuildingEntry } from '@shared/protocol';
import { THEME, panelStyle, titleStyle, hintStyle } from '../theme';

export interface CivilianPanelCallbacks {
  onAssign: (civilianId: number, buildingId: number | null) => void;
  onClose: () => void;
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  idle:      { label: 'Idle',      color: '#aaa' },
  working:   { label: 'Working',   color: '#44cc44' },
  fleeing:   { label: 'Fleeing',   color: '#ff4444' },
  wandering: { label: 'Wandering', color: '#ccaa44' },
  delivering: { label: 'Delivering', color: '#6699cc' },
  downed:    { label: 'Downed',    color: '#ff3333' },
};

const BUILDING_LABELS: Record<string, string> = {
  lumbermill: 'Lumbermill',
  quarry: 'Quarry',
  mine: 'Mine',
  farm: 'Farm',
  workshop: 'Workshop',
  repair_station: 'Repair Station',
};

type Tab = 'civilians' | 'buildings';

/**
 * Tabbed civilian management panel (C key).
 * Two tabs: Civilians (scrollable list) and Buildings (with assignment).
 */
export class CivilianPanelOverlay {
  private el: HTMLElement;
  private popEl: HTMLElement;
  private tabBar: HTMLElement;
  private tabBtnCiv: HTMLElement;
  private tabBtnBuild: HTMLElement;
  private contentEl: HTMLElement;
  private hintEl: HTMLElement;
  private visible = false;
  private callbacks: CivilianPanelCallbacks | null = null;
  private civilians: CivilianPanelEntry[] = [];
  private buildings: WorkableBuildingEntry[] = [];
  private selectedCivilianId: number | null = null;
  private activeTab: Tab = 'civilians';

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'civilian-panel-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'padding: 16px 20px',
      'display: none',
      'width: 520px',
      'user-select: none',
      'pointer-events: auto',
    ].join('; ');

    // Title
    const titleEl = document.createElement('div');
    titleEl.style.cssText = titleStyle(14) + '; margin-bottom: 4px;';
    titleEl.textContent = 'CIVILIAN MANAGEMENT';
    this.el.appendChild(titleEl);

    // Population counter
    this.popEl = document.createElement('div');
    this.popEl.style.cssText = `text-align: center; color: ${THEME.textSecondary}; font-size: 11px; margin-bottom: 10px;`;
    this.el.appendChild(this.popEl);

    // Tab bar
    this.tabBar = document.createElement('div');
    this.tabBar.style.cssText = `display: flex; gap: 0; margin-bottom: 8px; border-bottom: 1px solid ${THEME.accentRgba(0.2)};`;

    this.tabBtnCiv = this.createTabBtn('Civilians', 'civilians');
    this.tabBtnBuild = this.createTabBtn('Buildings', 'buildings');
    this.tabBar.appendChild(this.tabBtnCiv);
    this.tabBar.appendChild(this.tabBtnBuild);
    this.el.appendChild(this.tabBar);

    // Content area (scrollable)
    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 4px',
      'max-height: 340px',
      'overflow-y: auto',
      'padding-right: 4px',
    ].join('; ');
    // Custom scrollbar
    const styleTag = document.createElement('style');
    styleTag.textContent = `
      #civilian-panel-overlay .civ-scroll::-webkit-scrollbar { width: 4px; }
      #civilian-panel-overlay .civ-scroll::-webkit-scrollbar-track { background: transparent; }
      #civilian-panel-overlay .civ-scroll::-webkit-scrollbar-thumb { background: rgba(200,60,60,0.3); border-radius: 2px; }
    `;
    this.el.appendChild(styleTag);
    this.contentEl.classList.add('civ-scroll');
    this.el.appendChild(this.contentEl);

    // Hint
    this.hintEl = document.createElement('div');
    this.hintEl.style.cssText = hintStyle() + '; margin-top: 8px; font-size: 10px;';
    this.hintEl.textContent = 'Click a civilian, then switch to Buildings tab to assign. C / ESC to close.';
    this.el.appendChild(this.hintEl);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  private createTabBtn(label: string, tab: Tab): HTMLElement {
    const btn = document.createElement('div');
    btn.style.cssText = [
      'flex: 1',
      'text-align: center',
      'padding: 6px 0',
      `font-family: ${THEME.fontUI}`,
      'font-size: 11px',
      'font-weight: bold',
      'letter-spacing: 1px',
      'cursor: pointer',
      'transition: color 0.15s, border-color 0.15s',
      'border-bottom: 2px solid transparent',
      `color: ${THEME.textMuted}`,
    ].join('; ');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      this.activeTab = tab;
      this.updateTabStyles();
      this.rebuild();
    });
    return btn;
  }

  private updateTabStyles(): void {
    const active = (btn: HTMLElement, isActive: boolean) => {
      btn.style.color = isActive ? THEME.accent : THEME.textMuted;
      btn.style.borderBottomColor = isActive ? THEME.accent : 'transparent';
    };
    active(this.tabBtnCiv, this.activeTab === 'civilians');
    active(this.tabBtnBuild, this.activeTab === 'buildings');
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
    this.selectedCivilianId = null;
    this.activeTab = 'civilians';
    this.updateTabStyles();
    this.updatePopText(population, housingCapacity, 0);
    this.el.style.display = 'block';
    this.rebuild();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.selectedCivilianId = null;
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
    this.updatePopText(population, housingCapacity, nextSpawnSeconds);
    if (this.visible) this.rebuild();
  }

  private updatePopText(population: number, housingCapacity: number, nextSpawnSeconds: number): void {
    let text = `Population: ${population} / ${housingCapacity}`;
    if (nextSpawnSeconds > 0) {
      text += `  |  Next spawn: ${Math.ceil(nextSpawnSeconds)}s`;
    } else if (population >= housingCapacity) {
      text += `  |  At capacity`;
    }
    this.popEl.textContent = text;
  }

  private rebuild(): void {
    this.contentEl.innerHTML = '';

    if (this.activeTab === 'civilians') {
      this.buildCiviliansList();
    } else {
      this.buildBuildingsList();
    }

    this.updateHint();
  }

  // ── Civilians Tab ──────────────────────────────────────────────────────────

  private buildCiviliansList(): void {
    if (this.civilians.length === 0) {
      this.contentEl.appendChild(this.emptyMsg('No civilians yet.'));
      return;
    }

    for (const civ of this.civilians) {
      const isSelected = this.selectedCivilianId === civ.entityId;
      const row = document.createElement('div');
      const borderColor = isSelected ? THEME.accentRgba(0.6) : THEME.borderSubtle;
      row.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: ${THEME.surfaceBg}; border: 1px solid ${borderColor}; border-radius: ${THEME.radiusSm}; cursor: pointer; transition: border-color 0.1s; font-size: 12px;`;
      row.addEventListener('mouseenter', () => { if (!isSelected) row.style.borderColor = THEME.accentRgba(0.3); });
      row.addEventListener('mouseleave', () => { if (!isSelected) row.style.borderColor = THEME.borderSubtle; });

      // Name + specialty
      const nameEl = document.createElement('span');
      nameEl.style.cssText = `font-weight: bold; color: ${THEME.accent}; min-width: 75px; font-size: 12px;`;
      if (civ.specialty) {
        const specLabel = BUILDING_LABELS[civ.specialty] ?? civ.specialty;
        nameEl.innerHTML = `${esc(civ.name)} <span style="color:#e8c96a;font-size:9px;font-weight:normal" title="Specialized: ${specLabel}">&#9733;</span>`;
      } else {
        nameEl.textContent = civ.name;
      }
      row.appendChild(nameEl);

      // State badge
      const displayState = civ.downed ? 'downed' : civ.state;
      const stateInfo = STATE_LABELS[displayState] ?? STATE_LABELS.idle;
      const stateEl = document.createElement('span');
      stateEl.style.cssText = `color: ${stateInfo.color}; min-width: 60px; font-size: 11px;`;
      stateEl.textContent = stateInfo.label;
      row.appendChild(stateEl);

      // HP compact
      const hpEl = document.createElement('span');
      const hpPct = civ.maxHp > 0 ? civ.hp / civ.maxHp : 0;
      const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ddaa22' : '#cc3333';
      hpEl.style.cssText = `color: ${hpColor}; min-width: 44px; font-size: 11px;`;
      hpEl.textContent = `${civ.hp}/${civ.maxHp}`;
      row.appendChild(hpEl);

      // Hunger mini-bar
      const hungerPct = civ.hunger / 100;
      const hungerColor = hungerPct < 0.5 ? '#44aa44' : hungerPct < 0.8 ? '#ddaa22' : '#cc3333';
      const hungerWrap = document.createElement('div');
      hungerWrap.style.cssText = 'display: flex; align-items: center; gap: 3px; min-width: 60px;';
      hungerWrap.title = `Hunger: ${Math.round(civ.hunger)}%`;
      const hungerBar = document.createElement('div');
      hungerBar.style.cssText = 'flex: 1; height: 6px; background: #222; border-radius: 3px; overflow: hidden;';
      const hungerFill = document.createElement('div');
      hungerFill.style.cssText = `width: ${hungerPct * 100}%; height: 100%; background: ${hungerColor}; border-radius: 3px;`;
      hungerBar.appendChild(hungerFill);
      hungerWrap.appendChild(hungerBar);
      const hungerNum = document.createElement('span');
      hungerNum.style.cssText = `font-size: 9px; color: ${hungerColor}; min-width: 22px; text-align: right;`;
      hungerNum.textContent = `${Math.round(civ.hunger)}%`;
      hungerWrap.appendChild(hungerNum);
      row.appendChild(hungerWrap);

      // Assignment
      const assignEl = document.createElement('span');
      assignEl.style.cssText = `flex: 1; text-align: right; font-size: 10px; color: ${civ.assignedBuildingType ? '#7ac' : THEME.textMuted};`;
      assignEl.textContent = civ.assignedBuildingType
        ? (BUILDING_LABELS[civ.assignedBuildingType] ?? civ.assignedBuildingType)
        : 'Idle';
      row.appendChild(assignEl);

      // Unassign button
      if (civ.assignedBuildingId !== null && !civ.downed) {
        const unBtn = document.createElement('button');
        unBtn.style.cssText = 'background: rgba(200,50,50,0.25); border: 1px solid rgba(200,50,50,0.4); color: #e88; border-radius: 3px; padding: 1px 5px; font-size: 9px; cursor: pointer; line-height: 1.2;';
        unBtn.textContent = 'X';
        unBtn.title = 'Unassign';
        unBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks?.onAssign(civ.entityId, null);
        });
        row.appendChild(unBtn);
      }

      // Click to select
      if (!civ.downed) {
        row.addEventListener('click', () => {
          this.selectedCivilianId = this.selectedCivilianId === civ.entityId ? null : civ.entityId;
          this.rebuild();
        });
      }

      this.contentEl.appendChild(row);
    }
  }

  // ── Buildings Tab ──────────────────────────────────────────────────────────

  private buildBuildingsList(): void {
    if (this.buildings.length === 0) {
      this.contentEl.appendChild(this.emptyMsg('No production buildings placed.'));
      return;
    }

    for (const bldg of this.buildings) {
      const canAssign = this.selectedCivilianId !== null && bldg.workerName === null;
      const row = document.createElement('div');
      row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: ${THEME.surfaceBg}; border: 1px solid ${THEME.borderSubtle}; border-radius: ${THEME.radiusSm}; font-size: 12px;${canAssign ? ' cursor: pointer;' : ''}`;

      if (canAssign) {
        row.addEventListener('mouseenter', () => { row.style.borderColor = 'rgba(68, 204, 68, 0.4)'; row.style.background = 'rgba(68, 204, 68, 0.06)'; });
        row.addEventListener('mouseleave', () => { row.style.borderColor = THEME.borderSubtle; row.style.background = THEME.surfaceBg; });
        row.addEventListener('click', () => {
          if (this.selectedCivilianId !== null) {
            this.callbacks?.onAssign(this.selectedCivilianId, bldg.entityId);
            this.selectedCivilianId = null;
          }
        });
      }

      // Building icon dot
      const dot = document.createElement('span');
      dot.style.cssText = 'width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;';
      dot.style.background = bldg.workerName ? '#44cc44' : '#555';
      row.appendChild(dot);

      // Building type
      const typeEl = document.createElement('span');
      typeEl.style.cssText = 'min-width: 90px; color: #aac; font-weight: bold;';
      typeEl.textContent = BUILDING_LABELS[bldg.buildingType] ?? bldg.buildingType;
      row.appendChild(typeEl);

      // Worker
      const workerEl = document.createElement('span');
      workerEl.style.cssText = 'flex: 1; text-align: right;';
      if (bldg.workerName) {
        workerEl.style.color = THEME.accent;
        workerEl.textContent = bldg.workerName;
      } else {
        workerEl.style.color = canAssign ? '#44cc44' : THEME.textMuted;
        workerEl.textContent = canAssign ? 'Click to assign' : 'No worker';
      }
      row.appendChild(workerEl);

      this.contentEl.appendChild(row);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private updateHint(): void {
    if (this.selectedCivilianId !== null) {
      const civ = this.civilians.find(c => c.entityId === this.selectedCivilianId);
      if (this.activeTab === 'civilians') {
        this.hintEl.textContent = civ ? `Selected: ${civ.name} - switch to Buildings tab to assign` : '';
      } else {
        this.hintEl.textContent = civ ? `Selected: ${civ.name} - click a building to assign` : '';
      }
      this.hintEl.style.color = THEME.accent;
    } else {
      this.hintEl.textContent = 'Click a civilian, then a building to assign. C / ESC to close.';
      this.hintEl.style.color = THEME.textMuted;
    }
  }

  private emptyMsg(text: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `text-align: center; color: ${THEME.textMuted}; padding: 20px 8px; font-size: 12px;`;
    el.textContent = text;
    return el;
  }
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
