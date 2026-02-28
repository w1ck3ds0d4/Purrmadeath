import { describe, it, expect } from 'vitest';
import { MessageType } from '../../shared/protocol';

describe('Protocol MessageType', () => {
  it('has unique values for all message types', () => {
    const values = Object.values(MessageType);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(MessageType)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      // Convention: value matches key (e.g. HANDSHAKE = 'HANDSHAKE')
      expect(value).toBe(key);
    }
  });

  it('contains all lifecycle messages', () => {
    expect(MessageType.HANDSHAKE).toBeDefined();
    expect(MessageType.HANDSHAKE_ACK).toBeDefined();
    expect(MessageType.PING).toBeDefined();
    expect(MessageType.PONG).toBeDefined();
    expect(MessageType.ERROR).toBeDefined();
  });

  it('contains all session messages', () => {
    expect(MessageType.SESSION_CREATE).toBeDefined();
    expect(MessageType.SESSION_JOIN).toBeDefined();
    expect(MessageType.SESSION_LEAVE).toBeDefined();
    expect(MessageType.SESSION_ACK).toBeDefined();
    expect(MessageType.PLAYER_JOINED).toBeDefined();
    expect(MessageType.PLAYER_LEFT).toBeDefined();
    expect(MessageType.SESSION_CLOSED).toBeDefined();
    expect(MessageType.SESSION_STATE).toBeDefined();
    expect(MessageType.SESSION_START).toBeDefined();
    expect(MessageType.SESSION_STARTING).toBeDefined();
  });

  it('contains all combat messages', () => {
    expect(MessageType.ATTACK).toBeDefined();
    expect(MessageType.ATTACK_PERFORMED).toBeDefined();
    expect(MessageType.HIT).toBeDefined();
    expect(MessageType.PROJECTILE_SPAWN).toBeDefined();
    expect(MessageType.PROJECTILE_REMOVE).toBeDefined();
  });

  it('contains Phase 7 class select message', () => {
    expect(MessageType.CLASS_SELECT).toBe('CLASS_SELECT');
  });
});
