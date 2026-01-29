const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isPrivateIp,
    isOriginAllowed,
    clampInputMagnitude,
    checkConnectionRateLimit
} = require('../../server/netSecurity');

describe('isPrivateIp', () => {
    it('accepts loopback 127.0.0.1',          () => assert.ok(isPrivateIp('127.0.0.1')));
    it('accepts 127.x (non-.1)',              () => assert.ok(isPrivateIp('127.0.0.100')));
    it('accepts 10.x',                        () => assert.ok(isPrivateIp('10.0.0.1')));
    it('accepts 192.168.x',                   () => assert.ok(isPrivateIp('192.168.1.100')));
    it('accepts 172.16.x (lower bound)',       () => assert.ok(isPrivateIp('172.16.0.1')));
    it('accepts 172.20.x (mid-range)',         () => assert.ok(isPrivateIp('172.20.5.5')));
    it('accepts 172.31.x (upper bound)',       () => assert.ok(isPrivateIp('172.31.255.254')));
    it('accepts IPv6 loopback ::1',            () => assert.ok(isPrivateIp('::1')));
    it('accepts IPv4-mapped IPv6 loopback',    () => assert.ok(isPrivateIp('::ffff:127.0.0.1')));
    it('accepts IPv4-mapped private',          () => assert.ok(isPrivateIp('::ffff:192.168.1.1')));
    it('rejects public IP 8.8.8.8',           () => assert.ok(!isPrivateIp('8.8.8.8')));
    it('rejects 172.15.x (below range)',       () => assert.ok(!isPrivateIp('172.15.0.1')));
    it('rejects 172.32.x (above range)',       () => assert.ok(!isPrivateIp('172.32.0.1')));
    it('rejects empty string',                () => assert.ok(!isPrivateIp('')));
});

describe('isOriginAllowed', () => {
    it('allows any origin when allowedOrigins is empty',
        () => assert.ok(isOriginAllowed('http://anywhere.example', [])));
    it('allows exact match',
        () => assert.ok(isOriginAllowed('http://localhost:3001', ['http://localhost:3001'])));
    it('allows match among multiple',
        () => assert.ok(isOriginAllowed('http://b', ['http://a', 'http://b'])));
    it('rejects non-matching origin',
        () => assert.ok(!isOriginAllowed('http://evil.example', ['http://localhost:3001'])));
    it('rejects missing origin header when list is non-empty',
        () => assert.ok(!isOriginAllowed('', ['http://localhost:3001'])));
    it('rejects non-string origin',
        () => assert.ok(!isOriginAllowed(null, ['http://localhost:3001'])));
});

describe('clampInputMagnitude', () => {
    it('passes a vector already within max magnitude', () => {
        const r = clampInputMagnitude(0.5, 0.5, 1);
        assert.ok(Math.hypot(r.x, r.y) <= 1 + 1e-9);
    });
    it('clamps a vector exceeding max to unit magnitude', () => {
        const r = clampInputMagnitude(3, 4, 1);   // hypot = 5, should become 1
        assert.ok(Math.abs(Math.hypot(r.x, r.y) - 1) < 0.001);
    });
    it('preserves direction when clamping', () => {
        const r = clampInputMagnitude(3, 0, 1);
        assert.ok(Math.abs(r.x - 1) < 0.001 && Math.abs(r.y) < 0.001);
    });
    it('returns {0,0} for near-zero input without dividing by zero', () => {
        const r = clampInputMagnitude(0, 0, 1);
        assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
    });
});

describe('checkConnectionRateLimit', () => {
    it('allows a first connection', () => {
        const idx = new Map();
        assert.ok(checkConnectionRateLimit(idx, '1.2.3.4', 5));
    });
    it('allows connections up to the limit', () => {
        const idx = new Map();
        for (let i = 0; i < 4; i++) checkConnectionRateLimit(idx, '1.2.3.4', 5);
        assert.ok(checkConnectionRateLimit(idx, '1.2.3.4', 5));
    });
    it('blocks the connection that exceeds the limit', () => {
        const idx = new Map();
        for (let i = 0; i < 5; i++) checkConnectionRateLimit(idx, '1.2.3.4', 5);
        assert.ok(!checkConnectionRateLimit(idx, '1.2.3.4', 5));
    });
    it('rate-limits are per-IP — different IP is independent', () => {
        const idx = new Map();
        for (let i = 0; i < 5; i++) checkConnectionRateLimit(idx, '1.2.3.4', 5);
        assert.ok(checkConnectionRateLimit(idx, '5.6.7.8', 5));
    });
});
