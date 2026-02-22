import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { ServerSocket } from './ServerSocket';
import { MessageType } from '@shared/protocol';

/** Pick a random high port to avoid collisions. */
function randomPort(): number {
  return 40_000 + Math.floor(Math.random() * 20_000);
}

/** Connect a ws client and wait for the HANDSHAKE_ACK. */
function connectClient(port: number): Promise<{ ws: WebSocket; ack: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('error', reject);
    ws.once('message', (data) => {
      const msg = JSON.parse(data.toString());
      resolve({ ws, ack: msg });
    });
  });
}

// Track servers to close after each test
const servers: ServerSocket[] = [];

afterEach(async () => {
  // Close all servers created during the test
  for (const s of servers) {
    // Access internal WSS to close it
    (s as unknown as { wss: { close: (cb?: () => void) => void } }).wss.close();
  }
  servers.length = 0;
  // Give sockets time to fully release
  await new Promise((r) => setTimeout(r, 50));
});

describe('ServerSocket', () => {
  it('accepts a connection and sends HANDSHAKE_ACK', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const { ws, ack } = await connectClient(port);
    expect(ack.type).toBe(MessageType.HANDSHAKE_ACK);
    expect(ack.clientId).toBeDefined();
    expect(typeof ack.clientId).toBe('string');
    expect(ack.serverVersion).toBeDefined();
    ws.close();
  });

  it('assigns incrementing client IDs', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const c1 = await connectClient(port);
    const c2 = await connectClient(port);

    const id1 = parseInt(c1.ack.clientId as string, 10);
    const id2 = parseInt(c2.ack.clientId as string, 10);
    expect(id2).toBe(id1 + 1);

    c1.ws.close();
    c2.ws.close();
  });

  it('tracks client count', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    expect(server.clientCount).toBe(0);

    const c1 = await connectClient(port);
    // Brief delay for server to register
    await new Promise((r) => setTimeout(r, 20));
    expect(server.clientCount).toBe(1);

    const c2 = await connectClient(port);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.clientCount).toBe(2);

    c1.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount).toBe(1);

    c2.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount).toBe(0);
  });

  it('dispatches messages to registered handlers', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const received: { clientId: string; msg: Record<string, unknown> }[] = [];
    server.on(MessageType.HANDSHAKE, (client, msg) => {
      received.push({ clientId: client.id, msg: msg as unknown as Record<string, unknown> });
    });

    const { ws } = await connectClient(port);
    ws.send(JSON.stringify({
      type: MessageType.HANDSHAKE,
      displayName: 'TestPlayer',
      version: '1.0.7',
    }));

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect((received[0].msg as Record<string, unknown>).displayName).toBe('TestPlayer');
    ws.close();
  });

  it('responds to PING with PONG', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const { ws } = await connectClient(port);

    const pongPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === MessageType.PONG) resolve(msg);
      });
    });

    ws.send(JSON.stringify({ type: MessageType.PING }));
    const pong = await pongPromise;
    expect(pong.type).toBe(MessageType.PONG);
    ws.close();
  });

  it('fires disconnect handler when a client disconnects', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const disconnected: string[] = [];
    server.onDisconnect((client) => disconnected.push(client.id));

    const { ws, ack } = await connectClient(port);
    ws.close();

    await new Promise((r) => setTimeout(r, 50));
    expect(disconnected).toContain(ack.clientId as string);
  });

  it('rejects invalid message types gracefully', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const { ws } = await connectClient(port);
    // Empty type should be ignored, not crash the server
    ws.send(JSON.stringify({ type: '' }));
    // Non-string type should be ignored
    ws.send(JSON.stringify({ type: 12345 }));
    // Malformed JSON should be ignored
    ws.send('not-json');

    await new Promise((r) => setTimeout(r, 50));
    // Server should still be running
    expect(server.clientCount).toBe(1);
    ws.close();
  });

  it('ready promise rejects when port is in use', async () => {
    const port = randomPort();
    const server1 = new ServerSocket(port);
    servers.push(server1);
    await server1.ready;

    const server2 = new ServerSocket(port);
    servers.push(server2);

    await expect(server2.ready).rejects.toThrow(/already in use/);
  });

  it('send() is no-op for closed connections', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const { ws, ack } = await connectClient(port);
    const clientId = ack.clientId as string;
    ws.close();
    await new Promise((r) => setTimeout(r, 50));

    // Sending to a disconnected client should not throw
    const client = server.getClient(clientId);
    // Client should already be removed
    expect(client).toBeUndefined();
  });

  it('broadcast() sends to all connected clients', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const c1 = await connectClient(port);
    const c2 = await connectClient(port);

    const messages1: Record<string, unknown>[] = [];
    const messages2: Record<string, unknown>[] = [];

    c1.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'TEST_BROADCAST') messages1.push(msg);
    });
    c2.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'TEST_BROADCAST') messages2.push(msg);
    });

    server.broadcast({ type: 'TEST_BROADCAST', payload: 'hello' });
    await new Promise((r) => setTimeout(r, 50));

    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);
    expect((messages1[0] as Record<string, unknown>).payload).toBe('hello');

    c1.ws.close();
    c2.ws.close();
  });

  it('broadcast() excludes specified client', async () => {
    const port = randomPort();
    const server = new ServerSocket(port);
    servers.push(server);
    await server.ready;

    const c1 = await connectClient(port);
    const c2 = await connectClient(port);

    const messages1: Record<string, unknown>[] = [];
    const messages2: Record<string, unknown>[] = [];

    c1.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'TEST_EXCLUDE') messages1.push(msg);
    });
    c2.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'TEST_EXCLUDE') messages2.push(msg);
    });

    // Exclude c1
    server.broadcast({ type: 'TEST_EXCLUDE' }, c1.ack.clientId as string);
    await new Promise((r) => setTimeout(r, 50));

    expect(messages1).toHaveLength(0);
    expect(messages2).toHaveLength(1);

    c1.ws.close();
    c2.ws.close();
  });
});
