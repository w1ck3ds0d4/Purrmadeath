import { describe, it, expect } from 'vitest';
import { tileKey, findPath } from '../../../server/systems/Pathfinding';
import { TILE_SIZE } from '@shared/constants';
import { mockGenerator } from './__testutil';

describe('tileKey', () => {
  it('produces unique keys for different coordinates', () => {
    const keys = new Set([
      tileKey(0, 0), tileKey(1, 0), tileKey(0, 1),
      tileKey(-1, 0), tileKey(0, -1), tileKey(-1, -1),
      tileKey(100, 200), tileKey(200, 100),
    ]);
    expect(keys.size).toBe(8);
  });

  it('produces same key for same coordinates', () => {
    expect(tileKey(5, 10)).toBe(tileKey(5, 10));
    expect(tileKey(-3, -7)).toBe(tileKey(-3, -7));
  });
});

describe('findPath', () => {
  const allGrass = mockGenerator(); // all tiles walkable

  it('returns target position for same-tile start/goal', () => {
    const result = findPath(allGrass, 16, 16, 20, 20);
    expect(result).toEqual([{ x: 20, y: 20 }]);
  });

  it('finds a straight-line path on walkable terrain', () => {
    // 5 tiles apart horizontally
    const result = findPath(allGrass, 16, 16, 16 + TILE_SIZE * 5, 16);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    // Last waypoint should be the target
    expect(result![result!.length - 1]).toEqual({ x: 16 + TILE_SIZE * 5, y: 16 });
  });

  it('returns null when goal tile is unwalkable', () => {
    // Goal at tile (5,0) is deep water (TileId 1, unwalkable)
    const gen = mockGenerator((tx) => (tx === 5 ? 1 : 4));
    const result = findPath(gen, 16, 16, 5 * TILE_SIZE + 16, 16);
    expect(result).toBeNull();
  });

  it('routes around blocked tiles', () => {
    // Block tile (3, 0) - path must go around it
    const blocked = new Set([tileKey(3, 0)]);
    const result = findPath(allGrass, 16, 16, 6 * TILE_SIZE + 16, 16, blocked);
    expect(result).not.toBeNull();
    // Path should not pass through (3, 0)
    const t3center = { x: 3 * TILE_SIZE + TILE_SIZE / 2, y: TILE_SIZE / 2 };
    for (const wp of result!) {
      const onBlockedTile = Math.floor(wp.x / TILE_SIZE) === 3 && Math.floor(wp.y / TILE_SIZE) === 0;
      expect(onBlockedTile).toBe(false);
    }
  });

  it('uses bridge tiles over unwalkable terrain', () => {
    // Tile (2, 0) is water, but bridged
    const gen = mockGenerator((tx) => (tx === 2 ? 1 : 4));
    const bridges = new Set([tileKey(2, 0)]);
    const result = findPath(gen, 16, 16, 4 * TILE_SIZE + 16, 16, undefined, bridges);
    expect(result).not.toBeNull();
  });

  it('returns null when goal tile is blocked by building', () => {
    const blocked = new Set([tileKey(5, 0)]);
    const result = findPath(allGrass, 16, 16, 5 * TILE_SIZE + 16, 16, blocked);
    expect(result).toBeNull();
  });

  it('returns null when distance exceeds MAX_SEARCH_TILES', () => {
    // 50 tiles apart (MAX_SEARCH_TILES = 40)
    const result = findPath(allGrass, 0, 0, 50 * TILE_SIZE, 0);
    expect(result).toBeNull();
  });
});
