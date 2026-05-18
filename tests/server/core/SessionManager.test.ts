import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { ServerSocket } from '../../../server/net/ServerSocket';
import { SessionManager } from '../../../server/core/SessionManager';
import { MessageType } from '@shared/protocol';
import { GAME_VERSION } from '@shared/constants';

/** Minimal mock DiscoveryBeacon. */
function mockBeacon() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    update: vi.fn(),
  };
}

/** Connect a ws client and collect all messages received. */
function connectAndCollect(port: number): Promise<{
  ws: WebSocket;
  messages: Record<string, unknown>[];
  waitFor: (type: string, timeout?: number) => Promise<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: Record<string, unknown>[] = [];

    ws.once('error', reject);
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Wait for HANDSHAKE_ACK before resolving
    ws.once('message', () => {
      resolve({
        ws,
        messages,
        waitFor: (type: string, timeout = 2000) =>
          new Promise((res, rej) => {
            const existing = messages.find((m) => m.type === type);
            if (existing) { res(existing); return; }
            const timer = setTimeout(() => rej(new Error(`Timeout waiting for ${type}`)), timeout);
            const check = setInterval(() => {
              const found = messages.find((m) => m.type === type);
              if (found) { clearInterval(check); clearTimeout(timer); res(found); }
            }, 10);
          }),
      });
    });
  });
}

/** Send a HANDSHAKE then wait for acknowledgement processing. */
async function sendHandshake(ws: WebSocket, name = 'TestPlayer', playerId?: string): Promise<void> {
  ws.send(JSON.stringify({
    type: MessageType.HANDSHAKE,
    displayName: name,
    version: GAME_VERSION,
    ...(playerId ? { playerId } : {}),
  }));
  await new Promise((r) => setTimeout(r, 30));
}

// Track servers to close after each test
let server: ServerSocket | null = null;

afterEach(async () => {
  if (server) {
    (server as unknown as { wss: { close: (cb?: () => void) => void } }).wss.close();
    server = null;
  }
  await new Promise((r) => setTimeout(r, 50));
});

describe('SessionManager', () => {
  it('requires HANDSHAKE before SESSION_CREATE', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const c = await connectAndCollect(port);

    // Try to create session without handshake
    c.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await new Promise((r) => setTimeout(r, 50));

    const error = c.messages.find((m) => m.type === MessageType.ERROR);
    expect(error).toBeDefined();
    expect((error as Record<string, unknown>).code).toBe('NOT_IDENTIFIED');

    c.ws.close();
  });

  it('creates a session after HANDSHAKE', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const c = await connectAndCollect(port);
    await sendHandshake(c.ws, 'Host');

    c.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    const ack = await c.waitFor(MessageType.SESSION_ACK);

    expect(ack.sessionId).toBeDefined();
    expect(ack.code).toBeDefined();
    expect(typeof ack.code).toBe('string');
    expect((ack.code as string).length).toBe(4);
    expect(ack.isHost).toBe(true);
    expect(ack.slot).toBe(0);

    c.ws.close();
  });

  it('rejects SESSION_CREATE when a session already exists', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    // Host creates session
    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await host.waitFor(MessageType.SESSION_ACK);

    // Another client tries to create
    const other = await connectAndCollect(port);
    await sendHandshake(other.ws, 'Other');
    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 2100));
    other.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await new Promise((r) => setTimeout(r, 50));

    const error = other.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'SESSION_EXISTS',
    );
    expect(error).toBeDefined();

    host.ws.close();
    other.ws.close();
  });

  it('allows a player to join an existing session', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    // Host creates session
    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    const sessionAck = await host.waitFor(MessageType.SESSION_ACK);
    const code = (sessionAck as Record<string, unknown>).code as string;

    // Joiner joins
    const joiner = await connectAndCollect(port);
    await sendHandshake(joiner.ws, 'Joiner');
    joiner.ws.send(JSON.stringify({ type: MessageType.SESSION_JOIN, code }));
    const joinAck = await joiner.waitFor(MessageType.SESSION_ACK);

    expect(joinAck.isHost).toBe(false);
    expect(joinAck.slot).toBe(1);
    expect(joinAck.code).toBe(code);

    // Host should receive PLAYER_JOINED
    const joined = await host.waitFor(MessageType.PLAYER_JOINED);
    expect((joined as Record<string, unknown>).player).toBeDefined();

    host.ws.close();
    joiner.ws.close();
  });

  it('rejects join with invalid invite code', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    // Host creates session
    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await host.waitFor(MessageType.SESSION_ACK);

    // Joiner tries with wrong code
    const joiner = await connectAndCollect(port);
    await sendHandshake(joiner.ws, 'Joiner');
    joiner.ws.send(JSON.stringify({ type: MessageType.SESSION_JOIN, code: 'ZZZZ' }));
    await new Promise((r) => setTimeout(r, 50));

    const error = joiner.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'INVALID_CODE',
    );
    expect(error).toBeDefined();

    host.ws.close();
    joiner.ws.close();
  });

  it('rejects join when no session exists', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const c = await connectAndCollect(port);
    await sendHandshake(c.ws, 'Player');
    c.ws.send(JSON.stringify({ type: MessageType.SESSION_JOIN, code: '' }));
    await new Promise((r) => setTimeout(r, 50));

    const error = c.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'NO_SESSION',
    );
    expect(error).toBeDefined();

    c.ws.close();
  });

  it('class select updates player class in lobby', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE, playerClass: 'warrior' }));
    const ack = await host.waitFor(MessageType.SESSION_ACK);

    // Verify initial class
    const players = (ack as Record<string, unknown>).players as Array<Record<string, unknown>>;
    expect(players[0].playerClass).toBe('warrior');

    // Change class
    host.ws.send(JSON.stringify({ type: MessageType.CLASS_SELECT, playerClass: 'mage' }));
    const stateMsg = await host.waitFor(MessageType.SESSION_STATE);
    const updatedPlayers = (stateMsg as Record<string, unknown>).players as Array<Record<string, unknown>>;
    expect(updatedPlayers[0].playerClass).toBe('mage');

    host.ws.close();
  });

  it('defaults to warrior for invalid class', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE, playerClass: 'invalid_class' }));
    const ack = await host.waitFor(MessageType.SESSION_ACK);

    const players = (ack as Record<string, unknown>).players as Array<Record<string, unknown>>;
    expect(players[0].playerClass).toBe('warrior');

    host.ws.close();
  });

  it('rejects version mismatch in HANDSHAKE', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const c = await connectAndCollect(port);
    c.ws.send(JSON.stringify({
      type: MessageType.HANDSHAKE,
      displayName: 'OldClient',
      version: '0.0.1',
    }));
    await new Promise((r) => setTimeout(r, 50));

    const error = c.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'VERSION_MISMATCH',
    );
    expect(error).toBeDefined();

    c.ws.close();
  });

  it('only host can start the game', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    // Host creates session
    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await host.waitFor(MessageType.SESSION_ACK);

    // Joiner joins
    const joiner = await connectAndCollect(port);
    await sendHandshake(joiner.ws, 'Joiner');
    joiner.ws.send(JSON.stringify({ type: MessageType.SESSION_JOIN, code: '' }));
    await joiner.waitFor(MessageType.SESSION_ACK);

    // Joiner tries to start
    joiner.ws.send(JSON.stringify({ type: MessageType.SESSION_START }));
    await new Promise((r) => setTimeout(r, 50));

    const error = joiner.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'NOT_HOST',
    );
    expect(error).toBeDefined();

    host.ws.close();
    joiner.ws.close();
  });

  it('host leaving closes the session', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await host.waitFor(MessageType.SESSION_ACK);

    const joiner = await connectAndCollect(port);
    await sendHandshake(joiner.ws, 'Joiner');
    joiner.ws.send(JSON.stringify({ type: MessageType.SESSION_JOIN, code: '' }));
    await joiner.waitFor(MessageType.SESSION_ACK);

    // Host leaves
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_LEAVE }));
    const closed = await joiner.waitFor(MessageType.SESSION_CLOSED);
    expect(closed.reason).toBeDefined();

    host.ws.close();
    joiner.ws.close();
  });

  it('rate limits rapid session actions', async () => {
    server = new ServerSocket(0);
    await server.ready;
    const port = server.port;
    const _sm = new SessionManager(server, mockBeacon() as never);

    const host = await connectAndCollect(port);
    await sendHandshake(host.ws, 'Host');

    // First create succeeds
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await host.waitFor(MessageType.SESSION_ACK);

    // Immediately leave and try to create again (within cooldown)
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_LEAVE }));
    await new Promise((r) => setTimeout(r, 30));
    host.ws.send(JSON.stringify({ type: MessageType.SESSION_CREATE }));
    await new Promise((r) => setTimeout(r, 50));

    const rateLimited = host.messages.find(
      (m) => m.type === MessageType.ERROR && (m as Record<string, unknown>).code === 'RATE_LIMITED',
    );
    expect(rateLimited).toBeDefined();

    host.ws.close();
  });
});
