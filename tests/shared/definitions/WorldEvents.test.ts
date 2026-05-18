import { describe, it, expect } from 'vitest';
import {
  WORLD_EVENTS,
  pickWorldEvent,
  type WorldEventId,
} from '../../../shared/definitions/WorldEvents';

describe('WORLD_EVENTS', () => {
  const allIds = Object.keys(WORLD_EVENTS) as WorldEventId[];

  it('has the 5 shipping event types', () => {
    // Roster trimmed from the original 6 - blood_moon and portal_surge
    // were folded into solar_eclipse / surprise_attack respectively.
    expect(allIds).toHaveLength(5);
    expect(allIds).toContain('meteor_shower');
    expect(allIds).toContain('earthquake');
    expect(allIds).toContain('resource_boom');
    expect(allIds).toContain('surprise_attack');
    expect(allIds).toContain('solar_eclipse');
  });

  it('all events have valid fields', () => {
    for (const id of allIds) {
      const ev = WORLD_EVENTS[id];
      expect(ev.id).toBe(id);
      expect(ev.name.length).toBeGreaterThan(0);
      expect(ev.description.length).toBeGreaterThan(0);
      // Duration 0 is documented as "instant / lasts the whole day"
      // (see WorldEventDef in WorldEvents.ts), e.g. resource_boom.
      expect(ev.duration).toBeGreaterThanOrEqual(0);
      expect(ev.minWave).toBeGreaterThanOrEqual(1);
      expect(ev.weight).toBeGreaterThan(0);
      expect(ev.banner.length).toBeGreaterThan(0);
    }
  });

  it('resource_boom has the lowest minWave', () => {
    const minWaves = allIds.map(id => WORLD_EVENTS[id].minWave);
    const lowestMin = Math.min(...minWaves);
    expect(WORLD_EVENTS.resource_boom.minWave).toBe(lowestMin);
  });
});

describe('pickWorldEvent', () => {
  it('returns null for wave 1 (no events eligible)', () => {
    expect(pickWorldEvent(1)).toBeNull();
  });

  it('returns resource_boom or null at wave 2', () => {
    for (let i = 0; i < 50; i++) {
      const ev = pickWorldEvent(2);
      if (ev !== null) {
        expect(ev).toBe('resource_boom');
      }
    }
  });

  it('only returns eligible events for the wave', () => {
    for (let i = 0; i < 100; i++) {
      const ev = pickWorldEvent(4);
      if (ev !== null) {
        expect(WORLD_EVENTS[ev].minWave).toBeLessThanOrEqual(4);
      }
    }
  });

  it('returns all event types eventually at high waves', () => {
    const seen = new Set<WorldEventId>();
    for (let i = 0; i < 500; i++) {
      const ev = pickWorldEvent(30);
      if (ev) seen.add(ev);
    }
    // With 500 attempts, all 5 shipping events should appear
    expect(seen.size).toBe(5);
  });
});
