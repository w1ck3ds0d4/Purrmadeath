// Modularization gate — fails if any .js module exceeds LOC_LIMIT without a documented
// allowlist entry. Add to ALLOWLIST with justification before merging over-limit files.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LOC_LIMIT = 1000;

// Files that are permitted to exceed LOC_LIMIT, with documented reasons.
const ALLOWLIST = {
    [path.join('src', 'game', 'bootstrap.js')]:
        'Main orchestration entry point; in-progress decomposition per ROADMAP 2.2.8-A.',
    [path.join('server', 'multiplayerServer.js')]:
        'Main server coordinator; post-2.2.8-B extraction reduced to ~1390 LOC; further extraction planned.',
};

function collectJsFiles(dir, root, results = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.parcel-cache' || entry.name === 'dist' || entry.name === 'tests') {
                continue;
            }
            collectJsFiles(fullPath, root, results);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(path.relative(root, fullPath));
        }
    }
    return results;
}

function countLines(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
}

describe('modularization gate', () => {
    const root = path.resolve(__dirname, '..');
    const jsFiles = [
        ...collectJsFiles(path.join(root, 'src'), root),
        ...collectJsFiles(path.join(root, 'server'), root)
    ];

    it('no unallowlisted module exceeds ' + LOC_LIMIT + ' lines', () => {
        const violations = [];
        for (const relPath of jsFiles) {
            const loc = countLines(path.join(root, relPath));
            const normalised = relPath.replace(/\\/g, path.sep);
            if (loc > LOC_LIMIT && !ALLOWLIST[normalised]) {
                violations.push(`${relPath} — ${loc} LOC (limit: ${LOC_LIMIT})`);
            }
        }
        if (violations.length > 0) {
            assert.fail(
                'The following modules exceed the LOC limit and are not on the allowlist.\n' +
                'Either extract a sub-module or add an entry to ALLOWLIST in tests/modularizationGate.test.js:\n\n' +
                violations.map((v) => `  • ${v}`).join('\n')
            );
        }
    });

    it('all allowlist entries refer to real files', () => {
        for (const relPath of Object.keys(ALLOWLIST)) {
            const fullPath = path.join(root, relPath);
            assert.ok(
                fs.existsSync(fullPath),
                `Allowlist entry "${relPath}" does not exist — remove it from the allowlist`
            );
        }
    });
});
