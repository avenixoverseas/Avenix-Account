import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
for (const path of ['css/app.css','css/luxury-botanical.css','css/floral-finish.css','css/token-management.css','css/payroll-responsive.css','js/app.js','assets/avenix-logo.png']) {
  await readFile(new URL(`../${path}`, import.meta.url));
}
assert.match(html, /id="main-nav"/);
assert.match(html, /id="page-content"/);
assert.ok(html.includes('type="module" src="js/app.js"'));
console.log('Local asset and core navigation shell checks OK.');

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(app, /global_activity/);
assert.match(app, /order\('event_number', \{ ascending: true \}\)/);
