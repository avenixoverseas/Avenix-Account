import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const app = readFileSync(join(root, 'js/app.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/app.css'), 'utf8');
const navBlock = app.match(/const NAV = \[([\s\S]*?)\n\];/);
assert.ok(navBlock, 'NAV configuration must exist');
const nav = [...navBlock[1].matchAll(/\['([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\]/g)].map(m => ({ key:m[1], label:m[2], access:m[3], icon:m[4] }));
assert.equal(nav.length, 23, `Expected 23 navigation entries (Dashboard + 22 menus), found ${nav.length}`);
assert.equal(new Set(nav.map(n => n.key)).size, nav.length, 'Navigation keys must be unique');
assert.equal(new Set(nav.map(n => n.label)).size, nav.length, 'Navigation labels must be unique');
const routeSwitch = app.slice(app.indexOf('async function renderPage(page)'), app.indexOf('/* ===================== DASHBOARD'));
for (const item of nav) {
  assert.ok(routeSwitch.includes(`case '${item.key}'`), `Menu '${item.label}' has no renderPage route`);
  const svg = join(root, 'assets/icons', `${item.icon}.svg`);
  const png = join(root, 'assets/icons', `${item.icon}.png`);
  assert.ok(existsSync(svg) || existsSync(png), `Menu '${item.label}' icon asset missing (${item.icon})`);
}
// Every static local HTML src/href points to a real file (ignore fragments, remote URLs and runtime-generated URLs).
for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const target = m[1];
  if (/^(?:https?:|data:|#|mailto:|tel:|javascript:)/i.test(target)) continue;
  const path = target.split(/[?#]/)[0];
  if (path) assert.ok(existsSync(join(root, path)), `Missing local HTML asset: ${target}`);
}
// Local CSS url() assets must exist.
for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
  const target = m[1].trim();
  if (/^(?:https?:|data:|#)/i.test(target)) continue;
  const path = target.split(/[?#]/)[0];
  assert.ok(existsSync(resolve(root, 'css', path)), `Missing local CSS asset: ${target}`);
}
// HTML IDs must be unique to keep selectors and form actions deterministic.
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML id attributes found');
// Confirm the removed flower asset is no longer referenced or shipped.
assert.ok(!app.includes('rose-gold-floral.svg') && !css.includes('rose-gold-floral.svg'), 'Obsolete rose asset still referenced');
assert.ok(existsSync(join(root, 'assets/gold-botanical-ribbon.svg')), 'Gold botanical ribbon asset missing');
assert.ok(!existsSync(join(root, 'assets/rose-gold-floral.svg')), 'Obsolete rose asset still present');
console.log(`Navigation/assets integrity passed: ${nav.length} routes (${nav.length - 1} non-dashboard menus), route cases and icons verified; local HTML/CSS assets exist; IDs are unique; no rose artwork remains.`);
