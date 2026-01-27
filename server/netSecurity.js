function normalizeRemoteAddress(rawAddress) {
    if (typeof rawAddress !== 'string') {
        return '';
    }
    const mappedPrefix = '::ffff:';
    if (rawAddress.startsWith(mappedPrefix)) {
        return rawAddress.slice(mappedPrefix.length);
    }
    return rawAddress;
}

function isPrivateIpv4(ipAddress) {
    if (ipAddress.startsWith('10.')) {
        return true;
    }
    if (ipAddress.startsWith('192.168.')) {
        return true;
    }
    if (ipAddress.startsWith('127.')) {
        return true;
    }
    const parts = ipAddress.split('.').map((value) => Number(value));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            return true;
        }
    }
    return false;
}

function isPrivateIp(rawAddress) {
    const address = normalizeRemoteAddress(rawAddress);
    if (!address) {
        return false;
    }
    if (address === '::1' || address === 'localhost') {
        return true;
    }
    if (address.includes(':')) {
        return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:') || address === '::1';
    }
    return isPrivateIpv4(address);
}

function isOriginAllowed(originHeader, allowedOrigins) {
    if (!allowedOrigins.length) {
        return true;
    }
    if (typeof originHeader !== 'string' || !originHeader) {
        return false;
    }
    return allowedOrigins.includes(originHeader);
}

function checkConnectionRateLimit(rateIndexByIp, ipAddress, maxPerMinute) {
    const now = Date.now();
    const existing = rateIndexByIp.get(ipAddress) ?? [];
    const recent = existing.filter((timestamp) => now - timestamp <= 60000);
    recent.push(now);
    rateIndexByIp.set(ipAddress, recent);
    return recent.length <= maxPerMinute;
}

function clampInputMagnitude(x, y, maxMagnitude) {
    const mag = Math.hypot(x, y);
    if (mag <= maxMagnitude || mag <= 0.0001) {
        return { x, y };
    }
    return { x: x / mag, y: y / mag };
}

module.exports = {
    normalizeRemoteAddress,
    isPrivateIp,
    isOriginAllowed,
    checkConnectionRateLimit,
    clampInputMagnitude
};
