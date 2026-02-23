import type { PlayerClass } from '@shared/ClassDefinitions';
import {
  SKILL_BRANCHES,
  type SkillBranch,
  type SkillNode,
  type SkillNodeId,
  type SkillBranchId,
  canAllocate,
  getActiveAbilities,
} from '@shared/SkillDefinitions';
import { CARD_POOL, RARITY_BORDER_COLORS, CATEGORY_COLORS } from '@shared/CardDefinitions';

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 56;
const TIER_GAP_Y = 16;
const BRANCH_GAP_X = 24;
const HEADER_H = 50;

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
  private nodeEls = new Map<SkillNodeId, HTMLElement>();
  private onAllocate: ((nodeId: string) => void) | null = null;

  private allocated = new Set<string>();
  private skillPoints = 0;
  private playerClass: PlayerClass = 'warrior';
  private pickedCardIds: string[] = [];

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'skill-tree-screen';
    this.screen.style.cssText = `
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 24px;
      background: ${BG};
      overflow-y: auto;
      z-index: 100;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; max-width: ${3 * NODE_W + 2 * BRANCH_GAP_X + 40}px;
      margin-bottom: 16px;
    `;

    this.titleEl = document.createElement('h2');
    this.titleEl.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:22px;font-weight:700;color:#ccd8ea;letter-spacing:3px;margin:0;user-select:none;";
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
    this.screen.appendChild(header);

    // Branch columns container
    const branchRow = document.createElement('div');
    branchRow.style.cssText = `
      display: flex; gap: ${BRANCH_GAP_X}px; justify-content: center;
      width: 100%;
    `;
    this.screen.appendChild(branchRow);

    // Create 3 branch columns (populated on show)
    for (let i = 0; i < 3; i++) {
      const col = document.createElement('div');
      col.style.cssText = `
        display: flex; flex-direction: column; align-items: center; gap: ${TIER_GAP_Y}px;
        width: ${NODE_W}px;
      `;
      branchRow.appendChild(col);
      this.branchContainers.push(col);
    }

    // Picked cards section
    this.cardsContainer = document.createElement('div');
    this.cardsContainer.style.cssText = `
      width: 100%; max-width: ${3 * NODE_W + 2 * BRANCH_GAP_X + 40}px;
      margin-top: 20px;
    `;
    this.screen.appendChild(this.cardsContainer);

    // Key hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;margin-top:16px;user-select:none;';
    hint.textContent = 'Press K or ESC to close';
    this.screen.appendChild(hint);

    document.getElementById('overlay')!.appendChild(this.screen);
  }

  get isVisible(): boolean {
    return this.screen.style.display !== 'none';
  }

  show(playerClass: PlayerClass, allocated: Set<string>, skillPoints: number, onAllocate: (nodeId: string) => void, pickedCardIds?: string[]): void {
    this.playerClass = playerClass;
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    this.onAllocate = onAllocate;
    if (pickedCardIds) this.pickedCardIds = pickedCardIds;
    this.screen.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.screen.style.display = 'none';
    this.onAllocate = null;
  }

  /** Update state from server without full rebuild. */
  updateState(allocated: Set<string>, skillPoints: number): void {
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    if (this.isVisible) this.rebuild();
  }

  private rebuild(): void {
    // Get the 3 branches for this class
    const branches = Object.values(SKILL_BRANCHES).filter(
      (b) => b.playerClass === this.playerClass,
    ) as SkillBranch[];

    this.pointsEl.textContent = `Skill Points: ${this.skillPoints}`;
    this.nodeEls.clear();

    const alloc = { allocated: this.allocated, skillPoints: this.skillPoints };

    for (let bi = 0; bi < 3; bi++) {
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
        display: flex; flex-direction: column; justify-content: center;
      `;
      branchHeader.innerHTML = `<span>${branch.name.toUpperCase()}</span><span style="font-size:11px;font-weight:400;color:#6a7a8a;margin-top:2px;">${branch.description}</span>`;
      col.appendChild(branchHeader);

      // Nodes (5 tiers)
      for (const node of branch.nodes) {
        const isAllocated = this.allocated.has(node.id);
        const isAvailable = !isAllocated && canAllocate(alloc, node.id, this.playerClass);

        const el = document.createElement('div');
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
      }
    }

    this.rebuildCards();
  }

  private rebuildCards(): void {
    this.cardsContainer.innerHTML = '';
    const cards = this.pickedCardIds
      .map(id => CARD_POOL.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c != null);
    if (cards.length === 0) return;

    // Section header
    const header = document.createElement('div');
    header.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:700;
      color:#e8c96a;letter-spacing:2px;margin-bottom:10px;user-select:none;
    `;
    header.textContent = `COLLECTED CARDS (${cards.length})`;
    this.cardsContainer.appendChild(header);

    // Card grid
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    for (const card of cards) {
      const catHex = '#' + CATEGORY_COLORS[card.category].toString(16).padStart(6, '0');
      const el = document.createElement('div');
      el.style.cssText = `
        width:140px;padding:8px 10px;border-radius:6px;
        background:${catHex}18;border:1px solid ${RARITY_BORDER_COLORS[card.rarity]};
        user-select:none;
      `;
      el.innerHTML = `
        <div style="font-family:'Segoe UI',sans-serif;font-size:12px;font-weight:600;color:#d8e2ef;">${card.name}</div>
        <div style="font-family:monospace;font-size:10px;color:#8a9ab0;margin-top:2px;">${card.description}</div>
        <div style="font-family:monospace;font-size:9px;color:${catHex};margin-top:4px;text-transform:uppercase;">${card.category} &middot; ${card.rarity}</div>
      `;
      grid.appendChild(el);
    }
    this.cardsContainer.appendChild(grid);
  }

  private nodeStyle(node: SkillNode, branch: SkillBranch, allocated: boolean, available: boolean): string {
    const color = hexColor(branch.color);
    let bg = LOCKED_COLOR;
    let border = LOCKED_BORDER;
    let shadow = 'none';

    if (allocated) {
      bg = color + '33'; // 20% alpha
      border = color;
      shadow = `0 0 8px ${color}66`;
    } else if (available) {
      bg = '#1a1a2e';
      border = AVAILABLE_GLOW;
      shadow = `0 0 12px ${AVAILABLE_GLOW}`;
    }

    const isCapstone = node.tier === 5;
    const borderWidth = isCapstone ? '2px' : '1px';

    return `
      width: ${NODE_W}px; height: ${NODE_H}px;
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
    const nameColor = allocated ? ALLOCATED_TEXT : (available ? '#b0c0d0' : '#5a5a6a');
    const descColor = allocated ? '#a0b0c0' : (available ? '#7a8a9a' : '#3a3a4a');
    const tierLabel = node.tier === 5 ? 'T5 CAPSTONE' : `Tier ${node.tier}`;
    const tierColor = allocated ? '#8a9ab0' : (available ? '#6a7a8a' : '#2a2a3a');

    let nameExtra = '';
    if (node.active) {
      nameExtra = ` <span style="font-size:10px;color:#e8c96a;">[${node.active.cooldown}s CD]</span>`;
    }

    return `
      <div style="font-family:monospace;font-size:10px;color:${tierColor};margin-bottom:2px;">${tierLabel}</div>
      <div style="font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:${nameColor};">${node.name}${nameExtra}</div>
      <div style="font-family:monospace;font-size:10px;color:${descColor};text-align:center;">${node.description}</div>
    `;
  }
}
