import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname;
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}
const files = await walk(join(root, 'js'));
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; process.stderr.write(`${file}\\n${result.stderr}\\n`); }
}
if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files checked.`);
