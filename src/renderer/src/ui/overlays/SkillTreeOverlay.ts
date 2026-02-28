import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import {
  SKILL_BRANCHES,
  type SkillBranch,
  type SkillNode,
  type SkillNodeId,
  type SkillBranchId,
  canAllocate,
  getActiveAbilities,
} from '@shared/definitions/SkillDefinitions';
import { CARD_POOL, RARITY_BORDER_COLORS, CATEGORY_COLORS } from '@shared/definitions/CardDefinitions';

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 56;
const CAPSTONE_H = 68;
const TIER_GAP_Y = 10;
const BRANCH_GAP_X = 12;
const HEADER_H = 36;
const SIDE_PANEL_W = 280;
const BRANCH_COUNT = 5;

// ── Colors ────────────────────────────────────────────────────────────────────

const BG = 'rgba(10, 10, 20, 0.95)';
const LOCKED_COLOR = '#2a2a3a';
const LOCKED_BORDER = '#3a3a4a';
const AVAILABLE_GLOW = 'rgba(200, 220, 255, 0.6)';
const ALLOCATED_TEXT = '#ffffff';

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export class SkillTreeOverlay {
  private screen: HTMLElement;
  private titleEl: HTMLElement;
  private pointsEl: HTMLElement;
  private branchContainers: HTMLElement[] = [];
  private cardsContainer: HTMLElement;
  private buffsContainer: HTMLElement;
  private nodeEls = new Map<SkillNodeId, HTMLElement>();
  private onAllocate: ((nodeId: string) => void) | null = null;
  private onHide: (() => void) | null = null;

  private allocated = new Set<string>();
  private skillPoints = 0;
  private playerClass: PlayerClass = 'warrior';
  private pickedCardIds: string[] = [];
  private completedBuffs: { displayName: string; reward: string; medalColor: string }[] = [];

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'skill-tree-screen';
    this.screen.style.display = 'none';

    // ── Full-height 3-column layout ──
    const layout = document.createElement('div');
    layout.style.cssText = 'display:flex;flex:1;min-height:0;width:100%;';

    // Left sidebar: Collected cards
    this.cardsContainer = document.createElement('div');
    this.cardsContainer.style.cssText = [
      `width:${SIDE_PANEL_W}px`,
      'flex-shrink:0',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:24px 20px',
      'border-right:1px solid rgba(255,255,255,0.06)',
      'overflow-y:auto',
    ].join(';');

    // Center column: header + skill tree
    const center = document.createElement('div');
    center.style.cssText = [
      'flex:1',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'padding:16px 12px',
      'overflow-y:auto',
      'min-width:0',
    ].join(';');

    // Header row
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; max-width: ${BRANCH_COUNT * NODE_W + (BRANCH_COUNT - 1) * BRANCH_GAP_X}px;
      margin-bottom: 20px; flex-shrink: 0;
    `;

    this.titleEl = document.createElement('h2');
    this.titleEl.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:22px;font-weight:700;color:#e8eef5;letter-spacing:3px;margin:0;user-select:none;";
    this.titleEl.textContent = 'SKILL TREE';

    this.pointsEl = document.createElement('div');
    this.pointsEl.style.cssText = "font-family:monospace;font-size:14px;color:#e8c96a;user-select:none;";

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    closeBtn.style.cssText = `
      background: none; border: 1px solid #4a4a5a; color: #8a9ab0;
      font-family: monospace; font-size: 16px; cursor: pointer;
      padding: 4px 10px; border-radius: 4px;
    `;
    closeBtn.addEventListener('click', () => this.hide());

    header.appendChild(this.titleEl);
    header.appendChild(this.pointsEl);
    header.appendChild(closeBtn);
    center.appendChild(header);

    // Branch columns
    const branchRow = document.createElement('div');
    branchRow.style.cssText = `
      display: flex; gap: ${BRANCH_GAP_X}px; justify-content: center;
    `;
    center.appendChild(branchRow);

    for (let i = 0; i < BRANCH_COUNT; i++) {
      const col = document.createElement('div');
      col.style.cssText = `
        display: flex; flex-direction: column; align-items: center;
        width: ${NODE_W}px;
      `;
      branchRow.appendChild(col);
      this.branchContainers.push(col);
    }

    // Key hint at bottom of center
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;margin-top:auto;padding-top:16px;user-select:none;flex-shrink:0;';
    hint.textContent = 'Press K or ESC to close';
    center.appendChild(hint);

    // Right sidebar: Permanent buffs
    this.buffsContainer = document.createElement('div');
    this.buffsContainer.style.cssText = [
      `width:${SIDE_PANEL_W}px`,
      'flex-shrink:0',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:24px 20px',
      'border-left:1px solid rgba(255,255,255,0.06)',
      'overflow-y:auto',
    ].join(';');

    layout.append(this.cardsContainer, center, this.buffsContainer);
    this.screen.appendChild(layout);
    document.getElementById('overlay')!.appendChild(this.screen);
  }

  get isVisible(): boolean {
    return this.screen.style.display !== 'none';
  }

  show(playerClass: PlayerClass, allocated: Set<string>, skillPoints: number, onAllocate: (nodeId: string) => void, pickedCardIds?: string[], completedBuffs?: { displayName: string; reward: string; medalColor: string }[], onHide?: () => void): void {
    this.playerClass = playerClass;
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    this.onAllocate = onAllocate;
    this.onHide = onHide ?? null;
    if (pickedCardIds) this.pickedCardIds = pickedCardIds;
    if (completedBuffs) this.completedBuffs = completedBuffs;
    this.screen.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.screen.style.display = 'none';
    this.onAllocate = null;
    this.onHide?.();
    this.onHide = null;
  }

  /** Update state from server without full rebuild. */
  updateState(allocated: Set<string>, skillPoints: number): void {
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    if (this.isVisible) this.rebuild();
  }

  private rebuild(): void {
    const branches = Object.values(SKILL_BRANCHES).filter(
      (b) => b.playerClass === this.playerClass,
    ) as SkillBranch[];

    this.pointsEl.textContent = `Skill Points: ${this.skillPoints}`;
    this.nodeEls.clear();

    const alloc = { allocated: this.allocated, skillPoints: this.skillPoints };

    for (let bi = 0; bi < BRANCH_COUNT; bi++) {
      const col = this.branchContainers[bi];
      col.innerHTML = '';

      const branch = branches[bi];
      if (!branch) continue;

      // Branch header
      const branchHeader = document.createElement('div');
      branchHeader.style.cssText = `
        font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: 700;
        color: ${hexColor(branch.color)}; text-align: center;
        user-select: none; letter-spacing: 1px; height: ${HEADER_H}px;
        display: flex; align-items: center; justify-content: center;
      `;
      branchHeader.textContent = branch.name.toUpperCase();
      col.appendChild(branchHeader);

      // Nodes (5 tiers) with connector lines
      for (let ni = 0; ni < branch.nodes.length; ni++) {
        const node = branch.nodes[ni];
        const isAllocated = this.allocated.has(node.id);
        const isAvailable = !isAllocated && canAllocate(alloc, node.id, this.playerClass);

        const el = document.createElement('div');
        el.className = 'skill-node';
        el.style.cssText = this.nodeStyle(node, branch, isAllocated, isAvailable);
        el.innerHTML = this.nodeContent(node, isAllocated, isAvailable);

        if (isAvailable) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            this.onAllocate?.(node.id);
          });
          el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.03)'; });
          el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });
        }

        col.appendChild(el);
        this.nodeEls.set(node.id, el);

        // Connector line between nodes (except after capstone)
        if (ni < branch.nodes.length - 1) {
          const nextAllocated = this.allocated.has(branch.nodes[ni + 1].id);
          const lineAlpha = (isAllocated && nextAllocated) ? 0.7 : (isAllocated || nextAllocated) ? 0.4 : 0.15;
          const line = document.createElement('div');
          line.style.cssText = `width:2px;height:${TIER_GAP_Y}px;background:${hexColor(branch.color)};opacity:${lineAlpha};flex-shrink:0;`;
          col.appendChild(line);
        }
      }
    }

    this.rebuildCards();
    this.rebuildBuffs();
  }

  private rebuildCards(): void {
    // Keep the container element, just clear its dynamic children
    const container = this.cardsContainer;
    // Remove all children except the container itself stays
    while (container.firstChild) container.removeChild(container.firstChild);

    const cards = this.pickedCardIds
      .map(id => CARD_POOL.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c != null);
    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = "font-family:monospace;font-size:14px;color:#7a7a8a;user-select:none;padding-top:4px;";
      empty.textContent = 'No cards collected yet';
      container.appendChild(empty);
      return;
    }

    // Section header
    const header = document.createElement('div');
    header.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:700;
      color:#e8c96a;letter-spacing:2px;margin-bottom:6px;user-select:none;
    `;
    header.textContent = `CARDS (${cards.length})`;
    container.appendChild(header);

    // Vertical card list
    for (const card of cards) {
      const catHex = '#' + CATEGORY_COLORS[card.category].toString(16).padStart(6, '0');
      const el = document.createElement('div');
      el.style.cssText = `
        padding:8px 10px;border-radius:6px;
        background:${catHex}18;border:1px solid ${RARITY_BORDER_COLORS[card.rarity]};
        user-select:none;
      `;
      el.innerHTML = `
        <div style="font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#e8eef5;">${card.name}</div>
        <div style="font-family:monospace;font-size:12px;color:#a0b0c0;margin-top:2px;">${card.description}</div>
        <div style="font-family:monospace;font-size:10px;color:${catHex};margin-top:3px;text-transform:uppercase;">${card.category} &middot; ${card.rarity}</div>
      `;
      container.appendChild(el);
    }
  }

  private rebuildBuffs(): void {
    const container = this.buffsContainer;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (this.completedBuffs.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = "font-family:monospace;font-size:14px;color:#7a7a8a;user-select:none;padding-top:4px;";
      empty.textContent = 'No buffs earned yet';
      container.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:700;
      color:#55cc77;letter-spacing:2px;margin-bottom:6px;user-select:none;
    `;
    header.textContent = `BUFFS (${this.completedBuffs.length})`;
    container.appendChild(header);

    for (const buff of this.completedBuffs) {
      const el = document.createElement('div');
      el.style.cssText = `
        padding:8px 10px;border-radius:6px;
        background:${buff.medalColor}18;border:1px solid ${buff.medalColor};
        user-select:none;
      `;
      el.innerHTML = `
        <div style="font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#e8eef5;">${buff.displayName}</div>
        <div style="font-family:monospace;font-size:12px;color:${buff.medalColor};margin-top:4px;">${buff.reward}</div>
      `;
      container.appendChild(el);
    }
  }

  private nodeStyle(node: SkillNode, branch: SkillBranch, allocated: boolean, available: boolean): string {
    const color = hexColor(branch.color);
    let bg = LOCKED_COLOR;
    let border = LOCKED_BORDER;
    let shadow = 'none';

    if (allocated) {
      bg = color + '33';
      border = color;
      shadow = `0 0 8px ${color}66`;
    } else if (available) {
      bg = '#1a1a2e';
      border = node.tier === 5 ? '#e8c96a' : AVAILABLE_GLOW;
      shadow = node.tier === 5 ? '0 0 14px rgba(232, 201, 106, 0.5)' : `0 0 12px ${AVAILABLE_GLOW}`;
    }

    const isCapstone = node.tier === 5;
    const borderWidth = isCapstone ? '2px' : '1px';
    const h = isCapstone ? CAPSTONE_H : NODE_H;

    return `
      width: ${NODE_W}px; height: ${h}px;
      background: ${bg}; border: ${borderWidth} solid ${border};
      border-radius: ${isCapstone ? '8px' : '4px'};
      box-shadow: ${shadow};
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      padding: 4px 8px; box-sizing: border-box;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      user-select: none;
    `;
  }

  private nodeContent(node: SkillNode, allocated: boolean, available: boolean): string {
    const nameColor = allocated ? ALLOCATED_TEXT : (available ? '#dde4ef' : '#9a9aaa');
    const tierLabel = node.tier === 5 ? 'CAPSTONE' : `Tier ${node.tier}`;
    const tierColor = allocated ? '#a0b0c0' : (available ? '#8a9aaa' : '#5a5a6a');

    const cdLine = node.active
      ? `<div style="font-family:monospace;font-size:11px;color:#e8c96a;margin-top:2px;">${node.active.cooldown}s cooldown</div>`
      : '';

    return `
      <div class="skill-tooltip">${node.description}</div>
      <div style="font-family:monospace;font-size:10px;color:${tierColor};margin-bottom:2px;">${tierLabel}</div>
      <div style="font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:${nameColor};">${node.name}</div>
      ${cdLine}
    `;
  }
}
