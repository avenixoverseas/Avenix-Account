import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['js', 'tests'];
const files = [];
function walk(path) {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(mjs|js)$/.test(full)) files.push(full);
  }
}
for (const root of roots) walk(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`FAIL ${file}\n${result.stderr}`);
  }
}
if (failed) process.exit(1);
console.log(`JavaScript syntax check passed: ${files.length} files.`);
