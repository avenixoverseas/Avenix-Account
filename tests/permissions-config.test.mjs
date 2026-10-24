import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const OWNER = 'mohammadaffan@avenixoverseas.com';
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/admin-user-management/index.ts', import.meta.url), 'utf8');
const schemaPath = new URL('../supabase/sql/Supabase SQL.sql', import.meta.url);
assert.ok(existsSync(schemaPath), 'Authoritative Supabase SQL.sql must exist');
const schema = readFileSync(schemaPath, 'utf8');

assert.ok(app.includes(`OWNER_EMAIL = '${OWNER}'`), 'frontend must lock administrator access to the designated owner email');
assert.ok(app.includes("profile.role || '').trim().toUpperCase() !== 'ADMIN'"), 'frontend must still require ADMIN role');
assert.ok(app.includes('profile.active !== true'), 'frontend administrator access must require an active profile');

assert.ok(edge.includes(`OWNER_EMAIL = '${OWNER}'`), 'Edge Function must lock to designated owner email');
assert.ok(edge.includes("String(actor.role || '').trim().toUpperCase() !== 'ADMIN'"), 'Edge Function must require ADMIN role');
assert.ok(edge.includes('Only the designated system administrator can manage users'), 'Edge Function must reject non-owner admins');

assert.ok(schema.includes(`'${OWNER}'`), 'Supabase SQL is_admin must use designated owner email');
assert.ok(schema.includes("upper(trim(coalesce(p.role::text, ''))) = 'ADMIN'"), 'schema is_admin must require ADMIN role');
assert.ok(schema.includes('avatar_url'), 'schema must include profile avatar_url');
assert.ok(schema.includes('AUTHORITATIVE SUPABASE SQL'), 'schema file must carry authoritative header');

console.log('Role-based admin permission tests passed (owner-locked, single SQL file).');
