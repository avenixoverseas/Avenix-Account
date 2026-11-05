import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const allowedActions = new Set(['VIEW', 'ADD', 'EDIT', 'DELETE / VOID', 'DOWNLOAD', 'APPROVE']);
const allowedModules = new Set([
  'DASHBOARD', 'CLIENTS', 'SUB-AGENTS', 'BILLS & INVOICES', 'PAYMENTS & RECEIPTS', 'EXPENSES',
  'CASH ACCOUNTS', 'PETTY CASH', 'BANK ACCOUNTS', 'TRANSFERS & DEPOSITS', 'CLIENT LEDGERS',
  'SUB-AGENT LEDGERS', 'GENERAL LEDGER', 'FINANCIAL REPORTS', 'OUTSTANDING BALANCES', 'LOGIN HISTORY',
  'DOWNLOADED HISTORY', 'DELETED / VOIDED', 'BANK RECONCILIATION', 'BACKUP & RESTORE', 'USER MANAGEMENT', 'COMPANY SETTINGS', 'PASSWORD',
]);

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}
function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server configuration is incomplete. Contact the system administrator.' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in as an administrator first.' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'Your session is invalid or expired. Sign in again.' }, 401);
  const actorId = authData.user.id;
  const OWNER_EMAIL = 'mohammadaffan@avenixoverseas.com';
  // Only the designated owner email with an active ADMIN profile may manage users.
  const { data: actor, error: actorError } = await admin.from('profiles').select('id,role,active,email').eq('id', actorId).maybeSingle();
  const actorEmail = String(authData.user.email || '').trim().toLowerCase();
  const profileEmail = String(actor?.email || '').trim().toLowerCase();
  if (
    actorError || !actor || actor.active !== true ||
    String(actor.role || '').trim().toUpperCase() !== 'ADMIN' ||
    actorEmail !== OWNER_EMAIL ||
    profileEmail !== OWNER_EMAIL
  ) {
    return json({ error: 'Only the designated system administrator can manage users.' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  const action = cleanString(body.action, 40);
  const displayName = cleanString(body.display_name, 160);
  const mobile = cleanString(body.mobile, 30);
  const role = cleanString(body.role, 20).toUpperCase();
  const active = body.active === true;
  const email = cleanString(body.email, 254).toLowerCase();
  const password = body.password;
  const permissions = body.permissions;
  const targetId = cleanString(body.user_id, 64);

  if (!['create_user', 'update_user'].includes(action)) return json({ error: 'Unsupported user-management action.' }, 400);
  if (!displayName || displayName.length < 2) return json({ error: 'Enter the user’s full name.' }, 400);
  if (!['ADMIN', 'STAFF'].includes(role)) return json({ error: 'Choose a valid role.' }, 400);
  // Only the designated owner email may hold the ADMIN role.
  if (role === 'ADMIN' && action === 'create_user' && email !== 'mohammadaffan@avenixoverseas.com') {
    return json({ error: 'Only the designated owner account may be assigned the ADMIN role.' }, 403);
  }
  if (!mobile || mobile.length < 8) return json({ error: 'Enter a valid mobile number.' }, 400);
  if (!Array.isArray(permissions) || permissions.length > 300) return json({ error: 'Permission selections are missing or invalid.' }, 400);
  for (const p of permissions) {
    if (!p || typeof p !== 'object' || !allowedModules.has(p.module_key) || !allowedActions.has(p.action_key) || typeof p.allowed !== 'boolean') {
      return json({ error: 'One or more permission selections are invalid.' }, 400);
    }
  }
  if (password !== undefined && password !== null && password !== '' && !validPassword(password)) {
    return json({ error: 'Password must be between 12 and 128 characters.' }, 400);
  }

  let userId = targetId;
  let createdAuthUser = false;
  if (action === 'create_user') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!validPassword(password)) return json({ error: 'A password of at least 12 characters is required.' }, 400);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName, mobile },
    });
    if (createError || !created.user) return json({ error: createError?.message || 'Supabase Auth could not create this user.' }, 400);
    userId = created.user.id;
    createdAuthUser = true;
  } else {
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return json({ error: 'Select a valid existing user.' }, 400);
    const { data: target, error: targetError } = await admin.from('profiles').select('id,role,active,email').eq('id', userId).maybeSingle();
    if (targetError || !target) return json({ error: 'The selected user profile was not found.' }, 404);
    if (role === 'ADMIN' && String(target.email || '').trim().toLowerCase() !== 'mohammadaffan@avenixoverseas.com') {
      return json({ error: 'Only the designated owner account may be assigned the ADMIN role.' }, 403);
    }
    if (userId === actorId && (role !== 'ADMIN' || !active)) return json({ error: 'You cannot disable or demote your own administrator account.' }, 400);
    if (target.role === 'ADMIN' && (role !== 'ADMIN' || !active)) {
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ADMIN').eq('active', true);
      if (countError) return json({ error: 'Could not verify active administrator count. No changes were made.' }, 500);
      if ((count || 0) <= 1) return json({ error: 'At least one active administrator must remain.' }, 400);
    }
  }

  const profilePayload = { id: userId, display_name: displayName, email: action === 'create_user' ? email : undefined, mobile, role, active, updated_at: new Date().toISOString() } as Record<string, unknown>;
  if (action === 'update_user') delete profilePayload.email;
  const { error: profileError } = await admin.from('profiles').upsert(profilePayload, { onConflict: 'id' });
  if (profileError) {
    if (createdAuthUser) await admin.auth.admin.deleteUser(userId);
    return json({ error: 'User account was created but the profile could not be saved. Contact the system administrator.' }, 500);
  }

  if (typeof password === 'string' && password.length > 0 && action === 'update_user') {
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
    if (passwordError) return json({ error: 'Profile saved, but the password could not be updated. Try again or contact the administrator.' }, 500);
  }

  const permissionRows = permissions.map((p: { module_key: string; action_key: string; allowed: boolean }) => ({
    user_id: userId, module_key: p.module_key, action_key: p.action_key, allowed: p.allowed, created_by: actorId, updated_at: new Date().toISOString(),
  }));
  const { error: permissionsError } = await admin.from('user_permissions').upsert(permissionRows, { onConflict: 'user_id,module_key,action_key' });
  if (permissionsError) {
    if (createdAuthUser) {
      await admin.from('user_permissions').delete().eq('user_id', userId);
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
    return json({ error: 'Permissions could not be saved. Ensure the database schema is up to date, then try again.' }, 500);
  }

  await admin.from('audit_logs').insert({
    action: action === 'create_user' ? 'CREATE_USER' : 'UPDATE_USER',
    event_type: 'security', record_type: 'profiles', record_id: userId, actor_id: actorId,
    actor_email: authData.user.email || '',
    details: { role, active, permissions_count: permissionRows.length, password_changed: typeof password === 'string' && password.length > 0 },
  });

  return json({ success: true, user_id: userId, action, message: action === 'create_user' ? 'User created successfully.' : 'User updated successfully.' });
});
