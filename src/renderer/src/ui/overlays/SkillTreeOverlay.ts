import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import { CLASS_STATS, CLASS_DISPLAY_NAMES } from '@shared/definitions/ClassDefinitions';
import {
  SKILL_BRANCHES,
  type SkillBranch,
  type SkillNode,
  type SkillNodeId,
  canAllocate,
  getUnlockedAbilities,
} from '@shared/definitions/SkillDefinitions';
import { CARD_POOL, RARITY_BORDER_COLORS, CATEGORY_COLORS, type CardEffect } from '@shared/definitions/CardDefinitions';

// -- Layout constants ----------------------------------------------------------

const NODE_W = 180;
const NODE_H = 68;
const CAPSTONE_H = 80;
const TIER_GAP_Y = 12;
const BRANCH_GAP_X = 32;
const HEADER_H = 56;
const BRANCH_COUNT = 5;

// -- Colors --------------------------------------------------------------------

const BG = 'rgba(10, 10, 20, 0.95)';
const LOCKED_COLOR = '#2a2a3a';
const LOCKED_BORDER = '#3a3a4a';
const AVAILABLE_GLOW = 'rgba(200, 220, 255, 0.6)';
const ALLOCATED_TEXT = '#ffffff';

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// -- Tab types -----------------------------------------------------------------

type TabId = 'character' | 'skills' | 'cards';

// -- Buff reward parsing -------------------------------------------------------

interface BuffStatBonus {
  stat: string;
  value: number;
  display: string;
}

function parseBuffReward(reward: string): BuffStatBonus | null {
  // Parse reward strings like "+1 Defense", "+5% Crit Chance", "+10 Max HP"
  const match = reward.match(/^([+-]?\d+)(%?)\s+(.+)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const isPercent = match[2] === '%';
  const label = match[3];
  const map: Record<string, string> = {
    'Defense': 'defense',
    'Crit Chance': 'critChance',
    'Max HP': 'maxHp',
    'Speed': 'speed',
    'Max Stamina': 'maxStamina',
    'Gather Speed': 'gatherSpeed',
  };
  const stat = map[label];
  if (!stat) return null;
  return { stat, value: isPercent ? num / 100 : num, display: reward };
}

// -- Stats computation ---------------------------------------------------------

interface StatBreakdown {
  label: string;
  base: number;
  skills: number;
  cards: number;
  buffs: number;
  total: number;
  isPercent?: boolean;
  unit?: string;
}

function computeStats(
  playerClass: PlayerClass,
  allocated: Set<string>,
  pickedCardIds: string[],
  completedBuffs: { displayName: string; reward: string; medalColor: string }[],
): StatBreakdown[] {
  const cs = CLASS_STATS[playerClass];

  // Accumulate flat and multiplicative bonuses per stat
  const flatAdd: Record<string, number> = {};
  const multAdd: Record<string, number> = {};
  const cardFlat: Record<string, number> = {};
  const buffFlat: Record<string, number> = {};
  const buffMult: Record<string, number> = {};

  const add = (target: Record<string, number>, stat: string, val: number) => {
    target[stat] = (target[stat] ?? 0) + val;
  };

  // Skills
  for (const nodeId of allocated) {
    for (const branch of Object.values(SKILL_BRANCHES)) {
      const node = branch.nodes.find(n => n.id === nodeId);
      if (!node?.passive) continue;
      for (const p of node.passive) {
        if (p.mode === 'add') add(flatAdd, p.stat, p.value);
        else add(multAdd, p.stat, p.value);
      }
    }
  }

  // Cards
  const collectStatBuffs = (effect: CardEffect) => {
    if (effect.type === 'stat_buff') {
      add(cardFlat, effect.stat, effect.value);
    } else if (effect.type === 'multi') {
      for (const sub of effect.effects) collectStatBuffs(sub);
    }
  };
  for (const id of pickedCardIds) {
    const card = CARD_POOL.find(c => c.id === id);
    if (card) collectStatBuffs(card.effect);
  }

  // Permanent buffs
  for (const buff of completedBuffs) {
    const parsed = parseBuffReward(buff.reward);
    if (!parsed) continue;
    if (parsed.value < 1 && parsed.value > 0) add(buffMult, parsed.stat, parsed.value);
    else add(buffFlat, parsed.stat, parsed.value);
  }

  const g = (target: Record<string, number>, stat: string) => target[stat] ?? 0;

  // Compute each stat breakdown
  // For multiplicative stats from skills (damage, speed, attackSpeed, critChance):
  // Total = (Base + Flat) * (1 + SkillMult + CardMult)
  // We show skill bonus and card bonus as separate contributions

  function makeStat(
    label: string, base: number, stat: string,
    opts?: { isPercent?: boolean; unit?: string },
  ): StatBreakdown {
    const skillFlat = g(flatAdd, stat);
    const skillMult = g(multAdd, stat);
    const cardVal = g(cardFlat, stat);
    const bFlat = g(buffFlat, stat);
    const bMult = g(buffMult, stat);

    // For percentage stats (crit, attack speed), base is 0
    // Skills contribute: flat + (base * mult)
    // Cards contribute: card flat values
    // Buffs contribute: buff flat + (base * buffMult)

    const skillBonus = skillFlat + (base * skillMult);
    const cardBonus = base * cardVal + (opts?.isPercent ? cardVal : 0);
    const buffBonus = bFlat + (base * bMult);

    let total: number;
    if (opts?.isPercent) {
      // Percent stats: just sum everything
      total = base + skillFlat + skillMult + cardVal + bFlat + bMult;
    } else {
      // Normal stats: (base + flatAdds) * (1 + multAdds)
      const flatTotal = base + skillFlat + cardVal + bFlat;
      const multTotal = 1 + skillMult + bMult;
      total = flatTotal * multTotal;
    }

    return {
      label,
      base,
      skills: opts?.isPercent ? skillFlat + skillMult : skillBonus,
      cards: opts?.isPercent ? cardVal : cardVal,
      buffs: opts?.isPercent ? bFlat + bMult : buffBonus,
      total: Math.round(total * 100) / 100,
      isPercent: opts?.isPercent,
      unit: opts?.unit,
    };
  }

  return [
    makeStat('Max HP', cs.hp, 'maxHp'),
    makeStat('Defense', cs.defense, 'defense'),
    makeStat('Damage', cs.baseDamage, 'damage'),
    makeStat('Speed', cs.speed, 'speed'),
    makeStat('Crit Chance', 0, 'critChance', { isPercent: true }),
    makeStat('Attack Speed', 0, 'attackSpeed', { isPercent: true }),
    makeStat('HP Regen', 0, 'hpRegen', { unit: '/s' }),
    makeStat('Stamina', cs.stamina, 'maxStamina'),
  ];
}

// -- Overlay -------------------------------------------------------------------

export class SkillTreeOverlay {
  private screen: HTMLElement;
  private tabBar: HTMLElement;
  private tabContent: HTMLElement;
  private closeBtn: HTMLElement;
  private nodeEls = new Map<SkillNodeId, HTMLElement>();
  private onAllocate: ((nodeId: string) => void) | null = null;
  private onHide: (() => void) | null = null;

  private allocated = new Set<string>();
  private skillPoints = 0;
  private slotAssignments: [string | null, string | null, string | null] = [null, null, null];
  private playerClass: PlayerClass = 'warrior';
  private pickedCardIds: string[] = [];
  private completedBuffs: { displayName: string; reward: string; medalColor: string }[] = [];
  private onSlotAssign: ((slot: number, abilityId: string | null) => void) | null = null;
  private activeTab: TabId = 'character';

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'skill-tree-screen';
    this.screen.style.display = 'none';

    // Header bar with tabs + close
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:12px 24px;flex-shrink:0;
      border-bottom:1px solid rgba(255,255,255,0.08);
    `;

    // Tab bar
    this.tabBar = document.createElement('div');
    this.tabBar.style.cssText = 'display:flex;gap:4px;';
    header.appendChild(this.tabBar);

    // Spacer to push close button to the right
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;';
    header.appendChild(spacer);

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.textContent = 'X';
    this.closeBtn.style.cssText = `
      background:none;border:1px solid #4a4a5a;color:#8a9ab0;
      font-family:monospace;font-size:16px;cursor:pointer;
      padding:4px 10px;border-radius:4px;
    `;
    this.closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(this.closeBtn);

    // Tab content area
    this.tabContent = document.createElement('div');
    this.tabContent.style.cssText = 'flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;';

    this.screen.appendChild(header);
    this.screen.appendChild(this.tabContent);
    document.getElementById('overlay')!.appendChild(this.screen);
  }

  get isVisible(): boolean {
    return this.screen.style.display !== 'none';
  }

  show(
    playerClass: PlayerClass, allocated: Set<string>, skillPoints: number,
    onAllocate: (nodeId: string) => void, pickedCardIds?: string[],
    completedBuffs?: { displayName: string; reward: string; medalColor: string }[],
    onHide?: () => void,
    slotAssignments?: [string | null, string | null, string | null],
    onSlotAssign?: (slot: number, abilityId: string | null) => void,
  ): void {
    this.playerClass = playerClass;
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    this.onAllocate = onAllocate;
    this.onHide = onHide ?? null;
    if (pickedCardIds) this.pickedCardIds = pickedCardIds;
    if (completedBuffs) this.completedBuffs = completedBuffs;
    if (slotAssignments) this.slotAssignments = slotAssignments;
    this.onSlotAssign = onSlotAssign ?? null;
    this.screen.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.screen.style.display = 'none';
    this.onAllocate = null;
    this.onHide?.();
    this.onHide = null;
  }

  updateState(allocated: Set<string>, skillPoints: number, slotAssignments?: [string | null, string | null, string | null]): void {
    this.allocated = allocated;
    this.skillPoints = skillPoints;
    if (slotAssignments) this.slotAssignments = slotAssignments;
    if (this.isVisible) this.rebuild();
  }

  private rebuild(): void {
    this.rebuildTabBar();
    this.rebuildActiveTab();
  }

  // -- Tab bar -----------------------------------------------------------------

  private rebuildTabBar(): void {
    this.tabBar.innerHTML = '';
    const tabs: { id: TabId; label: string; badge?: string }[] = [
      { id: 'character', label: 'CHARACTER' },
      { id: 'skills', label: 'SKILLS', badge: this.skillPoints > 0 ? `${this.skillPoints}` : undefined },
      { id: 'cards', label: 'CARDS', badge: this.pickedCardIds.length > 0 ? `${this.pickedCardIds.length}` : undefined },
    ];

    for (const tab of tabs) {
      const el = document.createElement('button');
      const active = this.activeTab === tab.id;
      el.style.cssText = `
        background:${active ? 'rgba(255,255,255,0.08)' : 'none'};
        border:1px solid ${active ? 'rgba(255,255,255,0.15)' : 'transparent'};
        border-bottom:${active ? '2px solid #e8c96a' : '2px solid transparent'};
        color:${active ? '#e8eef5' : '#6a7a8a'};
        font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;
        letter-spacing:2px;cursor:pointer;
        padding:8px 20px;border-radius:4px 4px 0 0;
        transition:all 0.15s;
      `;

      el.textContent = tab.label;

      if (tab.badge) {
        const badge = document.createElement('span');
        badge.style.cssText = `
          margin-left:6px;background:#e8c96a;color:#1a1a2a;
          font-size:10px;font-weight:bold;padding:1px 5px;border-radius:8px;
        `;
        badge.textContent = tab.badge;
        el.appendChild(badge);
      }

      el.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.rebuild();
      });
      el.addEventListener('mouseenter', () => { if (!active) el.style.color = '#b0c0d0'; });
      el.addEventListener('mouseleave', () => { if (!active) el.style.color = '#6a7a8a'; });

      this.tabBar.appendChild(el);
    }
  }

  // -- Tab content dispatch ----------------------------------------------------

  private rebuildActiveTab(): void {
    this.tabContent.innerHTML = '';
    this.nodeEls.clear();

    switch (this.activeTab) {
      case 'character': this.buildCharacterTab(); break;
      case 'skills':    this.buildSkillsTab();    break;
      case 'cards':     this.buildCardsTab();     break;
    }
  }

  // == CHARACTER TAB ===========================================================

  private buildCharacterTab(): void {
    const container = document.createElement('div');
    container.style.cssText = `
      display:flex;gap:32px;padding:24px 32px;flex:1;min-height:0;
    `;

    // Left: Stats panel
    const statsPanel = document.createElement('div');
    statsPanel.style.cssText = 'flex:1;min-width:0;';

    const statsHeader = document.createElement('div');
    statsHeader.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:18px;font-weight:700;
      color:#e8eef5;letter-spacing:2px;margin-bottom:16px;
    `;
    statsHeader.textContent = `${CLASS_DISPLAY_NAMES[this.playerClass]} - Stats`;
    statsPanel.appendChild(statsHeader);

    // Stats table
    const stats = computeStats(this.playerClass, this.allocated, this.pickedCardIds, this.completedBuffs);
    const table = document.createElement('div');
    table.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

    // Table header
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      display:grid;grid-template-columns:140px 70px 70px 70px 70px 80px;
      padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.1);
    `;
    for (const h of ['Stat', 'Base', 'Skills', 'Cards', 'Buffs', 'Total']) {
      const cell = document.createElement('div');
      cell.style.cssText = `
        font-family:monospace;font-size:11px;font-weight:600;
        color:#6a7a8a;text-transform:uppercase;letter-spacing:1px;
        text-align:${h === 'Stat' ? 'left' : 'right'};
      `;
      cell.textContent = h;
      headerRow.appendChild(cell);
    }
    table.appendChild(headerRow);

    // Stat rows
    for (const stat of stats) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:grid;grid-template-columns:140px 70px 70px 70px 70px 80px;
        padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.03);
        transition:background 0.1s;
      `;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.03)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });

      const fmt = (v: number, isTotal?: boolean): string => {
        if (stat.isPercent) {
          if (v === 0 && !isTotal) return '-';
          return `${Math.round(v * 100)}%`;
        }
        if (v === 0 && !isTotal) return '-';
        const rounded = Math.round(v * 10) / 10;
        const prefix = v > 0 && !isTotal ? '+' : '';
        return `${prefix}${rounded}${stat.unit ?? ''}`;
      };

      const values = [
        { text: stat.label, color: '#c0d0e0', align: 'left', bold: true },
        { text: fmt(stat.base), color: '#8a9aaa', align: 'right', bold: false },
        { text: fmt(stat.skills), color: stat.skills !== 0 ? '#5599cc' : '#4a4a5a', align: 'right', bold: false },
        { text: fmt(stat.cards), color: stat.cards !== 0 ? '#aa66dd' : '#4a4a5a', align: 'right', bold: false },
        { text: fmt(stat.buffs), color: stat.buffs !== 0 ? '#55cc77' : '#4a4a5a', align: 'right', bold: false },
        { text: fmt(stat.total, true), color: '#e8c96a', align: 'right', bold: true },
      ];

      for (const v of values) {
        const cell = document.createElement('div');
        cell.style.cssText = `
          font-family:monospace;font-size:13px;
          color:${v.color};text-align:${v.align};
          ${v.bold ? 'font-weight:600;' : ''}
        `;
        cell.textContent = v.text;
        row.appendChild(cell);
      }

      table.appendChild(row);
    }

    statsPanel.appendChild(table);

    // Special effects section (from skills)
    const specials = this.collectSpecialEffects();
    if (specials.length > 0) {
      const specialHeader = document.createElement('div');
      specialHeader.style.cssText = `
        font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;
        color:#aa88cc;letter-spacing:1px;margin-top:24px;margin-bottom:8px;
      `;
      specialHeader.textContent = 'SPECIAL EFFECTS';
      statsPanel.appendChild(specialHeader);

      for (const s of specials) {
        const el = document.createElement('div');
        el.style.cssText = `
          font-family:monospace;font-size:12px;color:#b0a0c0;
          padding:4px 10px;border-left:2px solid #aa88cc33;margin-bottom:2px;
        `;
        el.textContent = s;
        statsPanel.appendChild(el);
      }
    }

    // Ability cards (from cards)
    const abilities = this.collectAbilityCards();
    if (abilities.length > 0) {
      const abilityHeader = document.createElement('div');
      abilityHeader.style.cssText = `
        font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;
        color:#aa66dd;letter-spacing:1px;margin-top:24px;margin-bottom:8px;
      `;
      abilityHeader.textContent = 'CARD ABILITIES';
      statsPanel.appendChild(abilityHeader);

      for (const a of abilities) {
        const el = document.createElement('div');
        el.style.cssText = `
          font-family:monospace;font-size:12px;color:#b0a0d0;
          padding:4px 10px;border-left:2px solid #aa66dd33;margin-bottom:2px;
        `;
        el.textContent = `${a.name} - ${a.description}`;
        statsPanel.appendChild(el);
      }
    }

    container.appendChild(statsPanel);

    // Right: Permanent buffs
    const buffsPanel = document.createElement('div');
    buffsPanel.style.cssText = `
      width:260px;flex-shrink:0;border-left:1px solid rgba(255,255,255,0.06);
      padding-left:24px;
    `;

    const buffsHeader = document.createElement('div');
    buffsHeader.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:700;
      color:#55cc77;letter-spacing:2px;margin-bottom:12px;
    `;
    buffsHeader.textContent = `PERMANENT BUFFS (${this.completedBuffs.length})`;
    buffsPanel.appendChild(buffsHeader);

    if (this.completedBuffs.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:monospace;font-size:13px;color:#5a5a6a;';
      empty.textContent = 'No buffs earned yet';
      buffsPanel.appendChild(empty);
    } else {
      for (const buff of this.completedBuffs) {
        const el = document.createElement('div');
        el.style.cssText = `
          padding:8px 10px;border-radius:6px;
          background:${buff.medalColor}18;border:1px solid ${buff.medalColor};
          margin-bottom:6px;
        `;

        const name = document.createElement('div');
        name.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:#e8eef5;";
        name.textContent = buff.displayName;
        el.appendChild(name);

        const reward = document.createElement('div');
        reward.style.cssText = `font-family:monospace;font-size:11px;color:${buff.medalColor};margin-top:3px;`;
        reward.textContent = buff.reward;
        el.appendChild(reward);

        buffsPanel.appendChild(el);
      }
    }

    container.appendChild(buffsPanel);

    // Hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;padding:8px 32px;flex-shrink:0;user-select:none;';
    hint.textContent = 'Press K or ESC to close';

    this.tabContent.appendChild(container);
    this.tabContent.appendChild(hint);
  }

  private collectSpecialEffects(): string[] {
    const effects: string[] = [];
    const labels: Record<string, string> = {
      lifesteal: 'Lifesteal',
      burn_dot: 'Burn DoT',
      thorns: 'Thorns',
      slow_on_hit: 'Slow on Hit',
      poison_dot: 'Poison DoT',
      stun_on_hit: 'Stun on Hit',
      holy_mark: 'Holy Mark',
      shadow_drain: 'Shadow Drain',
      arcane_mark: 'Arcane Mark',
      nature_blessing: 'Nature Blessing',
    };
    const units: Record<string, string> = {
      lifesteal: '%', burn_dot: ' dps', thorns: ' dmg', slow_on_hit: '%',
      poison_dot: ' dps', stun_on_hit: 's', holy_mark: '%', shadow_drain: ' dps',
      arcane_mark: '%', nature_blessing: ' hp/s',
    };
    const totals: Record<string, number> = {};

    for (const nodeId of this.allocated) {
      for (const branch of Object.values(SKILL_BRANCHES)) {
        const node = branch.nodes.find(n => n.id === nodeId);
        if (!node?.special) continue;
        for (const s of node.special) {
          totals[s.type] = (totals[s.type] ?? 0) + s.value;
        }
      }
    }

    for (const [type, val] of Object.entries(totals)) {
      const label = labels[type] ?? type;
      const unit = units[type] ?? '';
      const displayVal = unit === '%' ? `${Math.round(val * 100)}%` : `${val}${unit}`;
      effects.push(`${label}: ${displayVal}`);
    }
    return effects;
  }

  private collectAbilityCards(): { name: string; description: string }[] {
    const result: { name: string; description: string }[] = [];
    for (const id of this.pickedCardIds) {
      const card = CARD_POOL.find(c => c.id === id);
      if (!card) continue;
      if (card.category === 'ability' || (card.effect.type === 'multi' && card.effect.effects.some(e => e.type === 'ability'))) {
        result.push({ name: card.name, description: card.description });
      }
    }
    return result;
  }

  // == SKILLS TAB ==============================================================

  private buildSkillsTab(): void {
    const container = document.createElement('div');
    container.style.cssText = `
      flex:1;display:flex;flex-direction:column;align-items:center;
      padding:16px 12px;overflow-y:auto;min-width:0;
    `;

    // Header row
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      width:100%;max-width:${BRANCH_COUNT * NODE_W + (BRANCH_COUNT - 1) * BRANCH_GAP_X}px;
      margin-bottom:20px;flex-shrink:0;
    `;

    const title = document.createElement('h2');
    title.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:22px;font-weight:700;color:#e8eef5;letter-spacing:3px;margin:0;user-select:none;";
    title.textContent = 'SKILL TREE';

    const pointsEl = document.createElement('div');
    pointsEl.style.cssText = 'font-family:monospace;font-size:14px;color:#e8c96a;user-select:none;';
    pointsEl.textContent = `Skill Points: ${this.skillPoints}`;

    header.appendChild(title);
    header.appendChild(pointsEl);
    container.appendChild(header);

    // Branch columns
    const branchRow = document.createElement('div');
    branchRow.style.cssText = `display:flex;gap:${BRANCH_GAP_X}px;justify-content:center;`;
    container.appendChild(branchRow);

    const branches = Object.values(SKILL_BRANCHES).filter(
      (b) => b.playerClass === this.playerClass,
    ) as SkillBranch[];

    const alloc = { allocated: this.allocated, skillPoints: this.skillPoints, slotAssignments: this.slotAssignments };

    for (let bi = 0; bi < BRANCH_COUNT; bi++) {
      const col = document.createElement('div');
      col.style.cssText = `display:flex;flex-direction:column;align-items:center;width:${NODE_W}px;`;
      branchRow.appendChild(col);

      const branch = branches[bi];
      if (!branch) continue;

      // Branch header
      const branchHeader = document.createElement('div');
      branchHeader.style.cssText = `
        font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:700;
        color:${hexColor(branch.color)};text-align:center;
        user-select:none;letter-spacing:1px;height:${HEADER_H}px;
        display:flex;align-items:center;justify-content:center;
      `;
      branchHeader.textContent = branch.name.toUpperCase();
      col.appendChild(branchHeader);

      // Nodes
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
          el.addEventListener('click', () => { this.onAllocate?.(node.id); });
          el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.03)'; });
          el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });
        }

        col.appendChild(el);
        this.nodeEls.set(node.id, el);

        if (ni < branch.nodes.length - 1) {
          const bColor = hexColor(branch.color);
          const connectorColor = isAllocated ? bColor : `${bColor}4D`;
          const line = document.createElement('div');
          line.style.cssText = `width:2px;height:${TIER_GAP_Y}px;background:${connectorColor};flex-shrink:0;`;
          col.appendChild(line);
        }
      }
    }

    // Make allocated capstones draggable
    for (const nodeId of this.allocated) {
      const el = this.nodeEls.get(nodeId);
      if (!el) continue;
      const branch = Object.values(SKILL_BRANCHES).find(b => b.nodes.some(n => n.id === nodeId));
      const node = branch?.nodes.find(n => n.id === nodeId);
      if (!node?.active) continue;
      el.draggable = true;
      el.style.cursor = 'grab';
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData('text/plain', node.active!.abilityId);
        e.dataTransfer!.effectAllowed = 'move';
        el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', () => { el.style.opacity = '1'; });
    }

    // Ability assignment bar
    const abilityBar = document.createElement('div');
    abilityBar.style.cssText = `
      display:flex;gap:16px;justify-content:center;align-items:center;
      margin-top:20px;padding:12px 0;flex-shrink:0;
      border-top:1px solid rgba(255,255,255,0.06);
      width:100%;max-width:${BRANCH_COUNT * NODE_W + (BRANCH_COUNT - 1) * BRANCH_GAP_X}px;
    `;
    this.buildAbilityBar(abilityBar);
    container.appendChild(abilityBar);

    // Hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;margin-top:auto;padding-top:16px;user-select:none;flex-shrink:0;';
    hint.textContent = 'Drag capstone abilities to slots below - Press K or ESC to close';
    container.appendChild(hint);

    this.tabContent.appendChild(container);
  }

  private buildAbilityBar(bar: HTMLElement): void {
    const alloc = { allocated: this.allocated, skillPoints: this.skillPoints, slotAssignments: this.slotAssignments };
    const unlocked = getUnlockedAbilities(alloc);
    const slotKeys = ['Q', 'E', 'R'];

    const label = document.createElement('div');
    label.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:#8a9aaa;user-select:none;margin-right:8px;";
    label.textContent = 'ABILITY SLOTS:';
    bar.appendChild(label);

    for (let i = 0; i < 3; i++) {
      const assignedId = this.slotAssignments[i];
      const ability = unlocked.find(a => a.abilityId === assignedId);

      const slot = document.createElement('div');
      const hasAbility = ability != null;
      slot.style.cssText = [
        'width:140px', 'height:48px', 'border-radius:6px',
        `border:2px dashed ${hasAbility ? '#e8c96a66' : '#3a3a4a'}`,
        `background:${hasAbility ? '#2a2a3a' : '#1a1a2a'}`,
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'user-select:none',
        'transition:border-color 0.15s,background 0.15s', 'position:relative',
      ].join(';');

      const keyBadge = document.createElement('div');
      keyBadge.style.cssText = `
        position:absolute;top:-8px;left:8px;
        background:#1a1a2a;border:1px solid #3a3a4a;border-radius:3px;
        padding:0 5px;font-family:monospace;font-size:10px;color:#e8c96a;font-weight:bold;
      `;
      keyBadge.textContent = slotKeys[i];
      slot.appendChild(keyBadge);

      if (hasAbility) {
        const nameEl = document.createElement('div');
        nameEl.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:12px;font-weight:600;color:#e8eef5;";
        nameEl.textContent = ability!.name;
        slot.appendChild(nameEl);

        const cdEl = document.createElement('div');
        cdEl.style.cssText = 'font-family:monospace;font-size:10px;color:#8a9aaa;';
        cdEl.textContent = `${ability!.cooldown}s CD`;
        slot.appendChild(cdEl);
      } else {
        const emptyEl = document.createElement('div');
        emptyEl.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;';
        emptyEl.textContent = 'Drop ability';
        slot.appendChild(emptyEl);
      }

      // Drop handlers
      const slotIndex = i;
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        slot.style.borderColor = '#e8c96a';
        slot.style.background = '#2a2a3a';
      });
      slot.addEventListener('dragleave', () => {
        slot.style.borderColor = hasAbility ? '#e8c96a66' : '#3a3a4a';
        slot.style.background = hasAbility ? '#2a2a3a' : '#1a1a2a';
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        const abilityId = e.dataTransfer!.getData('text/plain');
        if (abilityId && unlocked.some(a => a.abilityId === abilityId)) {
          this.onSlotAssign?.(slotIndex, abilityId);
        }
        slot.style.borderColor = hasAbility ? '#e8c96a66' : '#3a3a4a';
        slot.style.background = hasAbility ? '#2a2a3a' : '#1a1a2a';
      });

      if (hasAbility) {
        slot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.onSlotAssign?.(slotIndex, null);
        });
        slot.style.cursor = 'pointer';
        slot.title = 'Right-click to unequip';
      }

      bar.appendChild(slot);
    }
  }

  // == CARDS TAB ===============================================================

  private buildCardsTab(): void {
    const container = document.createElement('div');
    container.style.cssText = 'padding:24px 32px;flex:1;overflow-y:auto;';

    const cards = this.pickedCardIds
      .map(id => CARD_POOL.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c != null);

    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = "font-family:monospace;font-size:14px;color:#7a7a8a;user-select:none;padding-top:4px;";
      empty.textContent = 'No cards collected yet';
      container.appendChild(empty);
      this.tabContent.appendChild(container);
      return;
    }

    const header = document.createElement('div');
    header.style.cssText = `
      font-family:'Segoe UI',sans-serif;font-size:18px;font-weight:700;
      color:#e8c96a;letter-spacing:2px;margin-bottom:16px;
    `;
    header.textContent = `COLLECTED CARDS (${cards.length})`;
    container.appendChild(header);

    // Group by category
    const categories: { key: string; label: string; color: string }[] = [
      { key: 'buff', label: 'Buffs', color: '#4a90d9' },
      { key: 'ability', label: 'Abilities', color: '#aa44ff' },
      { key: 'curse', label: 'Curses', color: '#cc6633' },
      { key: 'resource', label: 'Resources', color: '#66aa66' },
    ];

    for (const cat of categories) {
      const catCards = cards.filter(c => c.category === cat.key);
      if (catCards.length === 0) continue;

      const catHeader = document.createElement('div');
      catHeader.style.cssText = `
        font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;
        color:${cat.color};letter-spacing:1px;margin-top:16px;margin-bottom:8px;
      `;
      catHeader.textContent = `${cat.label.toUpperCase()} (${catCards.length})`;
      container.appendChild(catHeader);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

      for (const card of catCards) {
        const catHex = '#' + CATEGORY_COLORS[card.category].toString(16).padStart(6, '0');
        const el = document.createElement('div');
        el.style.cssText = `
          width:200px;padding:10px 12px;border-radius:6px;
          background:${catHex}18;border:1px solid ${RARITY_BORDER_COLORS[card.rarity]};
          user-select:none;box-sizing:border-box;
        `;

        const nameEl = document.createElement('div');
        nameEl.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:#e8eef5;";
        nameEl.textContent = card.name;
        el.appendChild(nameEl);

        const desc = document.createElement('div');
        desc.style.cssText = 'font-family:monospace;font-size:11px;color:#a0b0c0;margin-top:3px;';
        desc.textContent = card.description;
        el.appendChild(desc);

        const meta = document.createElement('div');
        meta.style.cssText = `font-family:monospace;font-size:10px;color:${catHex};margin-top:4px;text-transform:uppercase;`;
        meta.textContent = `${card.category} \u00b7 ${card.rarity}`;
        el.appendChild(meta);

        grid.appendChild(el);
      }

      container.appendChild(grid);
    }

    // Hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:monospace;font-size:11px;color:#4a5a6a;margin-top:24px;user-select:none;';
    hint.textContent = 'Press K or ESC to close';
    container.appendChild(hint);

    this.tabContent.appendChild(container);
  }

  // -- Shared style helpers ----------------------------------------------------

  private nodeStyle(node: SkillNode, branch: SkillBranch, allocated: boolean, available: boolean): string {
    const color = hexColor(branch.color);
    const isCapstone = node.tier === 5;
    let bg = LOCKED_COLOR;
    let border = LOCKED_BORDER;
    let shadow = 'none';

    if (allocated) {
      bg = color + '33';
      border = color;
      shadow = `0 0 8px ${color}66`;
    } else if (available) {
      bg = '#1a1a2e';
      border = isCapstone ? '#e8c96a' : AVAILABLE_GLOW;
      shadow = isCapstone ? '0 0 14px rgba(232, 201, 106, 0.5)' : `0 0 12px ${AVAILABLE_GLOW}`;
    } else if (isCapstone) {
      border = '#e8c96a44';
    }

    const borderWidth = isCapstone ? '2px' : '1px';
    const h = isCapstone ? CAPSTONE_H : NODE_H;

    return `
      width:${NODE_W}px;height:${h}px;
      background:${bg};border:${borderWidth} solid ${border};
      border-radius:${isCapstone ? '8px' : '4px'};
      box-shadow:${shadow};
      display:flex;flex-direction:column;justify-content:center;align-items:center;
      padding:4px 8px;box-sizing:border-box;
      transition:transform 0.15s ease,box-shadow 0.15s ease;
      user-select:none;
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
      <div style="font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:${nameColor};">${node.name}</div>
      ${cdLine}
    `;
  }
}
