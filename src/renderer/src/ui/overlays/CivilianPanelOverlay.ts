import type { CivilianPanelEntry, WorkableBuildingEntry } from '@shared/protocol';

export interface CivilianPanelCallbacks {
  onAssign: (civilianId: number, buildingId: number | null) => void;
  onClose: () => void;
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  idle:      { label: 'Idle',      color: '#aaa' },
  working:   { label: 'Working',   color: '#44cc44' },
  fleeing:   { label: 'Fleeing',   color: '#ff4444' },
  wandering: { label: 'Wandering', color: '#ccaa44' },
  downed:    { label: 'Downed',    color: '#ff3333' },
};

const BUILDING_LABELS: Record<string, string> = {
  lumbermill: 'Lumbermill',
  quarry: 'Quarry',
  mine: 'Mine',
  farm: 'Farm',
};

/**
 * HTML overlay for the Civilian Management Panel (C key).
 * Shows all civilians with status, hunger, assignment, and lets the player
 * reassign workers to production buildings.
 */
export class CivilianPanelOverlay {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private popEl: HTMLElement;
  private listEl: HTMLElement;
  private buildingsEl: HTMLElement;
  private hintEl: HTMLElement;
  private visible = false;
  private callbacks: CivilianPanelCallbacks | null = null;
  private civilians: CivilianPanelEntry[] = [];
  private buildings: WorkableBuildingEntry[] = [];
  private selectedCivilianId: number | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'civilian-panel-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'background: rgba(4, 4, 10, 0.92)',
      'backdrop-filter: blur(6px)',
      'border: 1px solid rgba(245, 192, 106, 0.3)',
      'border-radius: 8px',
      'padding: 20px 24px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'color: #ccd8ea',
      'display: none',
      'min-width: 500px',
      'max-width: 560px',
      'max-height: 70vh',
      'overflow-y: auto',
      'user-select: none',
      'pointer-events: auto',
    ].join('; ');

    // Title
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-weight: bold; font-size: 16px; color: #f5c06a; margin-bottom: 4px; text-align: center; letter-spacing: 2px;';
    this.titleEl.textContent = 'CIVILIAN MANAGEMENT';
    this.el.appendChild(this.titleEl);

    // Population counter
    this.popEl = document.createElement('div');
    this.popEl.style.cssText = 'text-align: center; color: #888; font-size: 12px; margin-bottom: 14px;';
    this.el.appendChild(this.popEl);

    // Civilians list
    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;';
    this.el.appendChild(this.listEl);

    // Buildings section
    const buildTitle = document.createElement('div');
    buildTitle.style.cssText = 'font-weight: bold; font-size: 13px; color: #f5c06a; margin-bottom: 6px; border-top: 1px solid rgba(245, 192, 106, 0.2); padding-top: 10px;';
    buildTitle.textContent = 'PRODUCTION BUILDINGS';
    this.el.appendChild(buildTitle);

    this.buildingsEl = document.createElement('div');
    this.buildingsEl.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;';
    this.el.appendChild(this.buildingsEl);

    // Hint
    this.hintEl = document.createElement('div');
    this.hintEl.style.cssText = 'text-align: center; color: #666; font-size: 11px; margin-top: 6px;';
    this.hintEl.textContent = 'Click a civilian, then a building to assign. Press C or ESC to close.';
    this.el.appendChild(this.hintEl);

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
    this.selectedCivilianId = null;
    this.popEl.textContent = `Population: ${population} / ${housingCapacity}`;
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
  ): void {
    this.civilians = civilians;
    this.buildings = buildings;
    this.popEl.textContent = `Population: ${population} / ${housingCapacity}`;
    if (this.visible) this.rebuild();
  }

  private rebuild(): void {
    // ── Civilians list ──────────────────────────────────────────────────
    this.listEl.innerHTML = '';

    if (this.civilians.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align: center; color: #666; padding: 8px;';
      empty.textContent = 'No civilians yet.';
      this.listEl.appendChild(empty);
    }

    for (const civ of this.civilians) {
      const row = document.createElement('div');
      const isSelected = this.selectedCivilianId === civ.entityId;
      const borderColor = isSelected ? 'rgba(245, 192, 106, 0.6)' : 'rgba(255,255,255,0.08)';
      row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(255,255,255,0.04); border: 1px solid ${borderColor}; border-radius: 4px; cursor: pointer; transition: border-color 0.15s;`;
      row.addEventListener('mouseenter', () => { if (!isSelected) row.style.borderColor = 'rgba(245, 192, 106, 0.3)'; });
      row.addEventListener('mouseleave', () => { if (!isSelected) row.style.borderColor = 'rgba(255,255,255,0.08)'; });

      // Name
      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'font-weight: bold; color: #f5c06a; min-width: 80px;';
      nameEl.textContent = civ.name;
      row.appendChild(nameEl);

      // State
      const displayState = civ.downed ? 'downed' : civ.state;
      const stateInfo = STATE_LABELS[displayState] ?? STATE_LABELS.idle;
      const stateEl = document.createElement('span');
      stateEl.style.cssText = `color: ${stateInfo.color}; min-width: 70px; font-size: 12px;`;
      stateEl.textContent = stateInfo.label;
      row.appendChild(stateEl);

      // HP
      const hpEl = document.createElement('span');
      const hpPct = civ.maxHp > 0 ? civ.hp / civ.maxHp : 0;
      const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ddaa22' : '#cc3333';
      hpEl.style.cssText = `color: ${hpColor}; min-width: 50px; font-size: 12px;`;
      hpEl.textContent = `${civ.hp}/${civ.maxHp}`;
      row.appendChild(hpEl);

      // Hunger bar
      const hungerContainer = document.createElement('div');
      hungerContainer.style.cssText = 'flex: 0 0 50px; height: 8px; background: #222; border-radius: 3px; overflow: hidden; position: relative;';
      const hungerFill = document.createElement('div');
      const hungerPct = civ.hunger / 100;
      const hungerColor = hungerPct < 0.5 ? '#44aa44' : hungerPct < 0.8 ? '#ddaa22' : '#cc3333';
      hungerFill.style.cssText = `width: ${hungerPct * 100}%; height: 100%; background: ${hungerColor}; border-radius: 3px;`;
      hungerContainer.appendChild(hungerFill);
      hungerContainer.title = `Hunger: ${civ.hunger}%`;
      row.appendChild(hungerContainer);

      // Assignment
      const assignEl = document.createElement('span');
      assignEl.style.cssText = 'flex: 1; text-align: right; font-size: 11px; color: #888;';
      if (civ.assignedBuildingType) {
        assignEl.textContent = BUILDING_LABELS[civ.assignedBuildingType] ?? civ.assignedBuildingType;
        assignEl.style.color = '#7ac';
      } else {
        assignEl.textContent = 'Unassigned';
      }
      row.appendChild(assignEl);

      // Unassign button (if assigned)
      if (civ.assignedBuildingId !== null && !civ.downed) {
        const unBtn = document.createElement('button');
        unBtn.style.cssText = 'background: rgba(200,50,50,0.3); border: 1px solid rgba(200,50,50,0.5); color: #e88; border-radius: 3px; padding: 2px 6px; font-size: 10px; cursor: pointer;';
        unBtn.textContent = 'X';
        unBtn.title = 'Unassign';
        unBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks?.onAssign(civ.entityId, null);
        });
        row.appendChild(unBtn);
      }

      // Click to select civilian for assignment
      if (!civ.downed) {
        row.addEventListener('click', () => {
          this.selectedCivilianId = this.selectedCivilianId === civ.entityId ? null : civ.entityId;
          this.rebuild();
        });
      }

      this.listEl.appendChild(row);
    }

    // ── Buildings list ───────────────────────────────────────────────────
    this.buildingsEl.innerHTML = '';

    if (this.buildings.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align: center; color: #666; padding: 4px; font-size: 12px;';
      empty.textContent = 'No production buildings placed.';
      this.buildingsEl.appendChild(empty);
    }

    for (const bldg of this.buildings) {
      const row = document.createElement('div');
      const canAssign = this.selectedCivilianId !== null && bldg.workerName === null;
      row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 3px; font-size: 12px;${canAssign ? ' cursor: pointer;' : ''}`;

      if (canAssign) {
        row.addEventListener('mouseenter', () => { row.style.borderColor = 'rgba(68, 204, 68, 0.4)'; row.style.background = 'rgba(68, 204, 68, 0.08)'; });
        row.addEventListener('mouseleave', () => { row.style.borderColor = 'rgba(255,255,255,0.06)'; row.style.background = 'rgba(255,255,255,0.03)'; });
        row.addEventListener('click', () => {
          if (this.selectedCivilianId !== null) {
            this.callbacks?.onAssign(this.selectedCivilianId, bldg.entityId);
            this.selectedCivilianId = null;
          }
        });
      }

      // Building type
      const typeEl = document.createElement('span');
      typeEl.style.cssText = 'min-width: 90px; color: #aac;';
      typeEl.textContent = BUILDING_LABELS[bldg.buildingType] ?? bldg.buildingType;
      row.appendChild(typeEl);

      // Worker
      const workerEl = document.createElement('span');
      workerEl.style.cssText = 'flex: 1; text-align: right;';
      if (bldg.workerName) {
        workerEl.style.color = '#f5c06a';
        workerEl.textContent = bldg.workerName;
      } else {
        workerEl.style.color = '#666';
        workerEl.textContent = canAssign ? 'Click to assign' : 'No worker';
      }
      row.appendChild(workerEl);

      this.buildingsEl.appendChild(row);
    }

    // Update hint
    if (this.selectedCivilianId !== null) {
      const civ = this.civilians.find(c => c.entityId === this.selectedCivilianId);
      this.hintEl.textContent = civ ? `Selected: ${civ.name} - click a building to assign` : '';
      this.hintEl.style.color = '#f5c06a';
    } else {
      this.hintEl.textContent = 'Click a civilian, then a building to assign. Press C or ESC to close.';
      this.hintEl.style.color = '#666';
    }
  }
}
