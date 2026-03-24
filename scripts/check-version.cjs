/**
 * Verify that package.json version matches GAME_VERSION in shared/constants.ts.
 * Run before builds to prevent version mismatch causing connection rejections.
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(__dirname, '..', 'package.json');
// GAME_VERSION lives in shared/constants/core.ts (after the constants split)
const constPath = path.resolve(__dirname, '..', 'shared', 'constants', 'core.ts');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const constSrc = fs.readFileSync(constPath, 'utf8');

const match = constSrc.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
  console.error('ERROR: Could not find GAME_VERSION in shared/constants/core.ts');
  process.exit(1);
}

const pkgVersion = pkg.version;
const gameVersion = match[1];

if (pkgVersion !== gameVersion) {
  console.error(`ERROR: Version mismatch!`);
  console.error(`  package.json:      ${pkgVersion}`);
  console.error(`  GAME_VERSION:      ${gameVersion}`);
  console.error(`\nUpdate both to match before building.`);
  process.exit(1);
}
