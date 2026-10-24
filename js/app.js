import { supabase, configured, requireClient } from './services/supabase.js';
import { money, date, dateTimeIST, localDateISO, escapeHtml, toast, mask, statusPill } from './modules/utils.js';
import { openForm, openInvoiceForm } from './modules/forms.js';
import { exportCsv, printDocument, printInvoice, printReport, printExpenseVoucher } from './modules/reports.js';
import { createJsonBackup } from './backup/backup.js';
import { isPostedFinancialStatus, inDateRange, cashBasedPreliminary, computePettyCashBalance, computeAccountBalance } from './modules/accounting.js';
import { COMPANY } from './config.js';

const $ = s => document.querySelector(s);
let session = null, profile = null, currentPage = 'dashboard';
let userPermissions = [];
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
let idleLogoutTimer = null;
let logoutInProgress = false;
function clearIdleLogout() { if (idleLogoutTimer) clearTimeout(idleLogoutTimer); idleLogoutTimer = null; }
function armIdleLogout() {
  clearIdleLogout();
  if (!session?.user?.id || logoutInProgress) return;
  idleLogoutTimer = setTimeout(() => performLogout('Your session ended after 2 minutes of inactivity.'), IDLE_TIMEOUT_MS);
}
async function performLogout(message = '') {
  if (logoutInProgress) return;
  logoutInProgress = true; clearIdleLogout();
  try {
    if (supabase && session?.user?.id) {
      try {
        await supabase.from('login_history').insert({
          user_id: session.user.id,
          user_email: session.user.email || profile?.email || null,
          event_type: 'sign_out',
          outcome: 'success'
        });
      } catch (logErr) { console.warn('Logout history insert failed', logErr); }
      await supabase.auth.signOut();
    }
  } catch (err) { console.error('Sign out request failed', err); }
  finally {
    session = profile = null; userPermissions = [];
    showLogin(); logoutInProgress = false;
    if (message) setLoginError(message);
  }
}

const NAV = [
  // [pageKey, moduleLabel, access, iconFile]
  ['dashboard', 'DASHBOARD', 'all', 'dashboard'],
  ['clients', 'CLIENTS', 'all', 'clients'],
  ['sub_agents', 'SUB-AGENTS', 'all', 'sub-agents'],
  ['invoices', 'BILLS & INVOICES', 'all', 'bills-invoices'],
  ['payments', 'PAYMENTS & RECEIPTS', 'all', 'payments-receipts'],
  ['expenses', 'EXPENSES', 'all', 'expenses'],
  ['cash_accounts', 'CASH ACCOUNTS', 'all', 'cash-accounts'],
  ['petty_cash', 'PETTY CASH', 'all', 'petty-cash'],
  ['bank_accounts', 'BANK ACCOUNTS', 'all', 'bank-accounts'],
  ['transfers', 'TRANSFERS & DEPOSITS', 'all', 'transfers-deposits'],
  ['client_ledger', 'CLIENT LEDGERS', 'all', 'client-ledgers'],
  ['agent_ledger', 'SUB-AGENT LEDGERS', 'all', 'client-ledgers'],
  ['general_ledger', 'GENERAL LEDGER', 'all', 'financial-reports'],
  ['reports', 'FINANCIAL REPORTS', 'all', 'financial-reports'],
  ['receivables', 'OUTSTANDING BALANCES', 'all', 'outstanding-balances'],
  ['audit_logs', 'LOGIN HISTORY', 'all', 'login-history'],
  ['downloads', 'DOWNLOADED HISTORY', 'all', 'download-history'],
  ['voided', 'DELETED / VOIDED', 'all', 'deleted-voided'],
  ['reconciliation', 'BANK RECONCILIATION', 'all', 'bank-reconciliation'],
  ['backup', 'BACKUP & RESTORE', 'all', 'backup-restore'],
  ['users', 'USER MANAGEMENT', 'admin', 'user-management'],
  ['settings', 'COMPANY SETTINGS', 'admin', 'company-settings'],
  ['password', 'PASSWORD', 'all', 'password']
];

// Designated owner only: active ADMIN profile whose auth + profile email match the locked owner.
// Backend/RLS is_admin() is authoritative; this is UI defence-in-depth only.
const OWNER_EMAIL = 'mohammadaffan@avenixoverseas.com';
const isAdmin = () => {
  if (!session?.user?.id || !profile || profile.id !== session.user.id) return false;
  if (String(profile.role || '').trim().toUpperCase() !== 'ADMIN' || profile.active !== true) return false;
  const authEmail = String(session.user.email || '').trim().toLowerCase();
  const profileEmail = String(profile.email || '').trim().toLowerCase();
  return authEmail === OWNER_EMAIL && profileEmail === OWNER_EMAIL;
};
const permissionKey = page => String(NAV.find(n => n[0] === page)?.[1] || '').toUpperCase();
const canDo = (moduleKey, action = 'VIEW') => isAdmin() || userPermissions.some(p => String(p.module_key || '').toUpperCase() === String(moduleKey || '').toUpperCase() && String(p.action_key || '').toUpperCase() === String(action).toUpperCase() && p.allowed === true);
const canViewPage = page => isAdmin() || page === 'password' || canDo(permissionKey(page), 'VIEW');

function navIcon(name) {
  // Consistent gold SVG icon set (falls back to PNG if SVG missing)
  const srcSvg = `assets/icons/${name}.svg`;
  const srcPng = `assets/icons/${name}.png`;
  return `<img class="nav-icon-img" src="${srcSvg}" width="22" height="22" alt="" loading="lazy" onerror="this.onerror=null;this.src='${srcPng}'">`;
}


/** Password reveal with eye icons; auto-hides after 30 seconds. */
const PASSWORD_REVEAL_MS = 30000;
const eyeOpenSrc = 'assets/icons/eye-open.svg';
const eyeClosedSrc = 'assets/icons/eye-closed.svg';
function setPasswordVisible(input, btn, visible) {
  if (!input) return;
  input.type = visible ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', String(!!visible));
    btn.title = visible ? 'Hide password' : 'Show password';
    let img = btn.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.width = 20; img.height = 20; img.alt = '';
      btn.textContent = '';
      btn.appendChild(img);
    }
    img.src = visible ? eyeOpenSrc : eyeClosedSrc;
  }
  if (btn?._revealTimer) { clearTimeout(btn._revealTimer); btn._revealTimer = null; }
  if (visible && btn) {
    btn._revealTimer = setTimeout(() => setPasswordVisible(input, btn, false), PASSWORD_REVEAL_MS);
  }
}
function bindPasswordReveal(input, btn) {
  if (!input || !btn || btn.dataset.revealBound === '1') return;
  btn.dataset.revealBound = '1';
  btn.type = 'button';
  setPasswordVisible(input, btn, false);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const showing = input.type === 'password';
    setPasswordVisible(input, btn, showing);
  });
}

function showLogin() {
  $('#login-screen').hidden = false;
  $('#app').hidden = true;
}

function showApp() {
  armIdleLogout();
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#user-badge').textContent = `${profile?.display_name || session.user.email} · ${profile?.role || 'STAFF'}`;
  $('#today-label').textContent = dateTimeIST(new Date());
  renderNav();
  navigate('dashboard');
}

function renderNav() {
  $('#main-nav').innerHTML = NAV
    .filter(n => isAdmin() ? true : (n[0] === 'dashboard' || n[0] === 'password' || (n[2] !== 'admin' && canViewPage(n[0]))))
    .map(n => `<button class="nav-item ${currentPage === n[0] ? 'active' : ''}" data-page="${n[0]}"><span class="nav-icon" aria-hidden="true">${navIcon(n[3])}</span><span>${n[1]}</span><span class="nav-chevron" aria-hidden="true">›</span></button>`)
    .join('');
  $('#main-nav').querySelectorAll('button').forEach(b => b.onclick = () => navigate(b.dataset.page));
}

async function boot() {
  if (!configured) {
    showLogin();
    setLoginError('Application is not configured. Contact your administrator.');
    return;
  }
  try {
    const { data: { session: s }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (s) await loadProfile(s);
    else showLogin();
  } catch (err) {
    console.error('Startup/session check failed', err);
    showLogin();
    setLoginError(friendlyAuthError(err));
  }
}

function setLoginError(message) {
  const el = $('#login-error');
  el.textContent = message;
  el.hidden = false;
}

function friendlyAuthError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Email or password is incorrect. Please try again.';
  if (msg.includes('email not confirmed')) return 'This account has not been activated yet. Contact your administrator.';
  if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('over_email_send_rate_limit')) return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch')) return 'Unable to connect. Check your internet connection and try again.';
  if (msg.includes('invalid api key') || msg.includes('apikey')) return 'Application configuration error. Contact your administrator.';
  if (msg.includes('project not found') || msg.includes('could not find the project')) return 'Application configuration error. Contact your administrator.';
  if (msg.includes('user not found')) return 'No account was found for this email. Contact your administrator.';
  if (msg.includes('session') && msg.includes('missing')) return 'Your session could not be established. Clear browser data for this site and try again.';
  return 'Sign-in failed. Please try again or contact your administrator.';
}

/** Map any technical/database error to a safe user-facing message. Never expose backend details. */
function friendlyError(err, fallback = 'Something went wrong. Please try again or contact your administrator.') {
  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();
  // Auth-style errors
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) return 'Email or password is incorrect. Please try again.';
  // Never show PostgREST / schema / RLS / table names
  if (/pgrst\d+/i.test(msg) || lower.includes('schema cache') || lower.includes('row-level security')
      || lower.includes('permission denied') || lower.includes('violates row-level')
      || lower.includes('could not find the table') || lower.includes('relation') && lower.includes('does not exist')
      || lower.includes('supabase') || lower.includes('postgrest')) {
    return fallback;
  }
  // Period lock and business rules are OK to show (they are intentional)
  if (lower.includes('period is locked') || lower.includes('books are closed')) return msg;
  if (lower.includes('not balanced') || lower.includes('exceed invoice') || lower.includes('must be positive')) return msg;
  // Generic network
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  // Default: if message looks technical (contains SQL-ish or code-ish tokens), hide it
  if (/\b(select|insert|update|delete|from public\.|auth\.|rpc)\b/i.test(msg) || msg.length > 180) {
    return fallback;
  }
  return msg || fallback;
}


async function loadProfile(s) {
  if (!s?.user?.id) throw new Error('Sign-in session is incomplete. Please try again.');
  session = s;
  let result;
  try {
    result = await supabase.from('profiles')
      .select('id,display_name,email,role,active,avatar_url,avatar_path')
      .eq('id', s.user.id)
      .maybeSingle();
  } catch (err) {
    console.error('Profile lookup failed', err);
    await supabase.auth.signOut().catch(() => {});
    session = profile = null;
    showLogin();
    setLoginError('Sign-in succeeded but your account profile could not be loaded. Contact your administrator.');
    return false;
  }
  const { data, error } = result;
  if (error || !data) {
    // The Auth UUID is useful for matching the profile, but do not log credentials or tokens.
    console.error('Authenticated user profile lookup failed', {
      reason: error ? 'query_error' : 'no_matching_row',
      message: error?.message || null,
      code: error?.code || null,
      authUserId: s.user.id
    });
    await supabase.auth.signOut().catch(() => {});
    session = profile = null;
    showLogin();
    if (error) {
      setLoginError('Sign-in succeeded but your account profile could not be loaded. Contact your administrator.');
    } else {
      setLoginError('Sign-in succeeded but no matching account profile was found. Contact your administrator.');
    }
    return false;
  }
  if (data.active !== true) {
    await supabase.auth.signOut().catch(() => {});
    session = profile = null;
    showLogin();
    setLoginError('Your account is disabled. Contact your administrator.');
    return false;
  }
  const role = String(data.role || '').toUpperCase();
  if (!['ADMIN', 'STAFF'].includes(role)) {
    await supabase.auth.signOut().catch(() => {});
    session = profile = null;
    showLogin();
    setLoginError('Your account role is not recognised. Contact your administrator.');
    return false;
  }
  profile = { ...data, role };
  userPermissions = [];
  if (role === 'STAFF') {
    try { const pr = await supabase.from('user_permissions').select('module_key,action_key,allowed').eq('user_id', s.user.id); if (pr.error) throw pr.error; userPermissions = pr.data || []; }
    catch (e) { console.error('Permission lookup failed; using deny-by-default', e); userPermissions = []; }
  }
  $('#login-error').hidden = true;
  // Record real authentication event (server timestamp via DB default)
  try {
    await supabase.from('login_history').insert({
      user_id: s.user.id,
      user_email: s.user.email || data.email || null,
      event_type: 'sign_in',
      outcome: 'success'
    });
  } catch (logErr) { console.warn('Login history insert failed', logErr); }
  showApp();
  return true;
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-form button[type="submit"]');
  $('#login-error').hidden = true;
  if (!configured || !supabase) {
    setLoginError('Application is not configured. Contact your administrator.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    console.info('Sign-in submitted.');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-password').value
    });
    if (error) throw error;
    console.info('Sign-in accepted; loading profile.');
    const ok = await loadProfile(data.session);
    if (ok) { $('#login-password').value = ''; }
  } catch (err) {
    console.error('Sign-in failed', { message: err?.message, status: err?.status, code: err?.code });
    setLoginError(friendlyAuthError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

$('#logout-btn').onclick = async () => { await performLogout(); };

// Any meaningful user activity resets the compulsory 2-minute idle timeout.
['pointerdown', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(type => {
  document.addEventListener(type, () => { if (session?.user?.id) armIdleLogout(); }, { passive: true });
});
['click', 'submit'].forEach(type => document.addEventListener(type, () => { if (session?.user?.id) armIdleLogout(); }, true));

// Password visibility toggle on the login form (auto-hide after 30s).
bindPasswordReveal($('#login-password'), $('#toggle-password'));

const mobileOverlay = document.createElement('button');
mobileOverlay.id = 'sidebar-overlay'; mobileOverlay.type = 'button'; mobileOverlay.setAttribute('aria-label', 'Close navigation');
document.body.appendChild(mobileOverlay);
function closeMobileNav() { $('.sidebar')?.classList.remove('open'); mobileOverlay.classList.remove('visible'); $('#mobile-menu')?.setAttribute('aria-expanded', 'false'); }
$('#mobile-menu').onclick = () => {
  const opening = !$('.sidebar').classList.contains('open');
  $('.sidebar').classList.toggle('open', opening); mobileOverlay.classList.toggle('visible', opening);
  $('#mobile-menu').setAttribute('aria-expanded', String(opening));
};
mobileOverlay.onclick = closeMobileNav;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMobileNav();
});
// Desktop keyboard navigation: move through menu items with Up/Down, Home and End.
document.querySelector('#main-nav')?.addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = [...document.querySelectorAll('#main-nav .nav-item, #main-nav a[href], #main-nav button.nav-link')]
    .filter(el => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  let next = current < 0 ? 0 : current;
  if (e.key === 'ArrowDown') next = (next + 1) % items.length;
  if (e.key === 'ArrowUp') next = (next - 1 + items.length) % items.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = items.length - 1;
  e.preventDefault();
  items[next].focus();
  items[next].scrollIntoView({ block: 'nearest' });
});
document.addEventListener('click', e => {
  if (window.matchMedia('(max-width: 720px)').matches && $('.sidebar')?.classList.contains('open') && !$('.sidebar').contains(e.target) && !$('#mobile-menu').contains(e.target)) closeMobileNav();
});

/* Desktop collapsible sidebar: narrow by default, expand on hover or pin */
(function initCollapsibleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar) return;

  const PIN_KEY = 'avenix_sidebar_pinned';
  const applyPin = (pinned) => {
    sidebar.classList.toggle('pinned', pinned);
    document.body.classList.toggle('sidebar-pinned', pinned);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(pinned));
      toggle.title = pinned ? 'Unpin menu (collapse)' : 'Pin menu open';
    }
    try { localStorage.setItem(PIN_KEY, pinned ? '1' : '0'); } catch (_) {}
  };

  // Restore pin preference
  let pinned = false;
  try { pinned = localStorage.getItem(PIN_KEY) === '1'; } catch (_) {}
  applyPin(pinned);

  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      // On mobile the mobile-menu handles drawer; this is desktop pin
      if (window.matchMedia('(max-width: 720px)').matches) return;
      applyPin(!sidebar.classList.contains('pinned'));
    });
    // When the menu toggle has keyboard focus, Up/Down scrolls the sidebar
    // so users can reach every item without relying on a mouse wheel.
    toggle.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const step = Math.max(140, Math.floor(sidebar.clientHeight * 0.65));
      if (e.key === 'ArrowDown') sidebar.scrollBy({ top: 64, behavior: 'auto' });
      if (e.key === 'ArrowUp') sidebar.scrollBy({ top: -64, behavior: 'auto' });
      if (e.key === 'PageDown') sidebar.scrollBy({ top: step, behavior: 'auto' });
      if (e.key === 'PageUp') sidebar.scrollBy({ top: -step, behavior: 'auto' });
      if (e.key === 'Home') sidebar.scrollTo({ top: 0, behavior: 'auto' });
      if (e.key === 'End') sidebar.scrollTo({ top: sidebar.scrollHeight, behavior: 'auto' });
    });
  }

  // Optional: brief expanded class while keyboard-focusing nav items
  sidebar.addEventListener('focusin', () => sidebar.classList.add('expanded'));
  sidebar.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!sidebar.contains(document.activeElement)) sidebar.classList.remove('expanded');
    }, 0);
  });
})();

async function navigate(page) {
  if (!NAV.some(n => n[0] === page)) page = 'dashboard';
  if (!isAdmin() && page !== 'dashboard' && page !== 'password' && (NAV.find(n => n[0] === page)?.[2] === 'admin' || !canViewPage(page))) {
    toast('Your administrator has not granted access to this menu.');
    page = 'dashboard';
  }
  currentPage = page;
  renderNav();
  $('#page-title').textContent = NAV.find(n => n[0] === page)?.[1] || 'Dashboard';
  $('#page-content').innerHTML = '<div class="loading">Loading records…</div>';
  closeMobileNav();
  try {
    await renderPage(page);
  } catch (e) {
    $('#page-content').innerHTML = `<div class="panel"><h2>Unable to load records</h2><p class="muted">Please try again. If the problem continues, contact your administrator.</p><button class="secondary" id="retry">Try again</button></div>`;
    $('#retry').onclick = () => navigate(page);
    console.error('Page load error', e);
  }
}

function panel(title, body, action = '') {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
}

async function query(table, select = '*', order = 'created_at') {
  const { data, error } = await requireClient().from(table).select(select).order(order, { ascending: false }).limit(1000);
  if (error) throw error;
  return data || [];
}

// Paginated reader for accounting reports/ledgers: never silently truncate at the UI's 1,000-row list limit.
async function queryAll(table, select = '*', order = 'created_at') {
  const client = requireClient();
  const pageSize = 1000;
  const all = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from(table).select(select).order(order, { ascending: true }).order('id', { ascending: true }).range(start, start + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

function tableHtml(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty">No records found.</td></tr>`}</tbody></table></div>`;
}

function searchToolbar(placeholder, button = '') {
  return `<div class="toolbar"><input id="table-search" placeholder="${placeholder}" aria-label="Search records">${button}</div>`;
}

function wireSearch() {
  const inp = $('#table-search');
  if (inp) inp.oninput = () => {
    const q = inp.value.toLowerCase();
    $('#records-table tbody')?.querySelectorAll('tr').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(q));
  };
}

async function renderPage(page) {
  switch (page) {
    case 'dashboard': return dashboard();
    case 'clients': return clients();
    case 'sub_agents': return agents();
    case 'invoices': return invoices();
    case 'payments': return payments();
    case 'expenses': return expenses();
    case 'cash_accounts': return accounts('cash_accounts');
    case 'petty_cash': return pettyCash();
    case 'bank_accounts': return accounts('bank_accounts');
    case 'transfers': return transfers();
    case 'client_ledger': return ledger('client');
    case 'agent_ledger': return ledger('agent');
    case 'general_ledger': return generalLedger();
    case 'reports': return reports();
    case 'receivables': return receivables();
    case 'audit_logs': return audit();
    case 'downloads': return downloads();
    case 'voided': return voided();
    case 'reconciliation': return reconciliation();
    case 'backup': return backup();
    case 'users': return users();
    case 'change_password': return passwordPage();
    case 'password': return passwordPage();
    case 'settings': return settings();
  }
}

/* ===================== DASHBOARD ===================== */
async function dashboard() {
  if (!session?.user?.id || !profile) { showLogin(); return; }
  const welcomeName = escapeHtml(profile?.display_name || session.user.email?.split('@')[0] || 'there');
  // Avatar objects live in a private Storage bucket. Generate a fresh signed URL
  // from the saved object path instead of relying on a URL saved at upload time.
  let resolvedAvatarUrl = profile?.avatar_url || '';
  if (profile?.avatar_path) {
    try {
      const { data: signedAvatar, error: signedAvatarError } = await requireClient()
        .storage.from('avatars').createSignedUrl(profile.avatar_path, 60 * 60);
      if (!signedAvatarError && signedAvatar?.signedUrl) resolvedAvatarUrl = signedAvatar.signedUrl;
      else console.warn('Dashboard avatar URL could not be refreshed', signedAvatarError?.message || 'signed_url_unavailable');
    } catch (avatarError) {
      console.warn('Dashboard avatar URL could not be refreshed', avatarError?.message || 'signed_url_failed');
    }
  }
  const avatarSrc = resolvedAvatarUrl ? escapeHtml(resolvedAvatarUrl) : '';
  const avatarInitial = escapeHtml((profile?.display_name || session.user.email || 'U').trim().charAt(0).toUpperCase() || 'U');
  const avatarHtml = avatarSrc
    ? `<img class="user-avatar" src="${avatarSrc}" alt="Profile photo" width="220" height="220" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'user-avatar fallback',textContent:'${avatarInitial}'}))">`
    : `<span class="user-avatar fallback" aria-hidden="true">${avatarInitial}</span>`;
  if (!isAdmin() && !canViewPage('dashboard')) {
    const masked = '<span class="masked-finance">* * * * * *</span>';
    $('#page-content').innerHTML = `<section class="welcome-banner"><div class="welcome-identity">${avatarHtml}<div><div class="eyebrow">AVENIX OVERSEAS · ACCOUNTS</div><h2>Welcome back, ${welcomeName}</h2><p>Your workspace is ready. Financial information is restricted by your administrator.</p></div></div><div class="welcome-date">${escapeHtml(dateTimeIST(new Date()))}</div></section><div class="stats-grid dashboard-stats">${[['Total billed','blue'],['Payments received','green'],['Cash balance','gold'],['Bank balance','purple']].map(([label,tone])=>`<article class="stat-card tone-${tone}"><span>${label}</span><strong>${masked}</strong><small>Permission required</small></article>`).join('')}</div>${panel('Monthly income & expenses', `<div class="restricted-panel">${masked}<p>Ask your administrator for Dashboard access to view financial summaries.</p></div>`)}${panel('Recent invoices', `<div class="restricted-panel">${masked}<p>Invoice amounts and bills are hidden because Dashboard permission has not been granted.</p></div>`)}`;
    return;
  }
  const [inv, pay, exp, cash, bank, transfersData] = await Promise.all([
    queryAll('invoices', 'id,invoice_no,invoice_date,total,status,created_at,client_name_snapshot', 'created_at'),
    queryAll('payments', 'id,amount,payment_date,status,account_type,account_id,invoice_id,created_at', 'payment_date'),
    queryAll('expenses', 'id,amount,expense_date,status,account_type,account_id,created_at', 'expense_date'),
    query('cash_accounts', 'id,name,opening_balance,active', 'name'),
    query('bank_accounts', 'id,bank_name,account_label,account_number,opening_balance,active', 'bank_name'),
    queryAll('transfers', 'id,amount,status,source_type,source_id,destination_type,destination_id,transfer_date', 'transfer_date')
  ]);
  const total = rows => rows.reduce((sum, r) => sum + Number(r.amount ?? r.total ?? 0), 0);
  const postedPay = pay.filter(r => isPostedFinancialStatus(r.status));
  const postedExp = exp.filter(r => isPostedFinancialStatus(r.status));
  const validInv = inv.filter(r => !/(void|cancel|revers)/i.test(String(r.status||'')));
  const cashBalances = cash.map(a => ({account:a, ...computeAccountBalance({accountType:'cash',accountId:a.id,openingBalance:a.opening_balance,payments:pay,expenses:exp,transfers:transfersData})}));
  const bankBalances = bank.map(a => ({account:a, ...computeAccountBalance({accountType:'bank',accountId:a.id,openingBalance:a.opening_balance,payments:pay,expenses:exp,transfers:transfersData})}));
  const cashTotal = cashBalances.reduce((sum, row) => sum + row.currentBalance, 0);
  const bankTotal = bankBalances.reduce((sum, row) => sum + row.currentBalance, 0);
  const paidByInvoice = new Map();
  postedPay.forEach(p => { if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id)||0)+Number(p.amount||0)); });
  const outstanding = validInv.map(i => ({...i, outstanding:Math.max(0,Number(i.total||0)-(paidByInvoice.get(i.id)||0))})).filter(i=>i.outstanding>0.009);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
  const overdue = outstanding.filter(i => i.invoice_date && new Date(i.invoice_date+'T00:00:00') < cutoff);
  const stats = [
    ['Total billed', money(total(validInv)), `${validInv.length} valid invoices`, 'blue'],
    ['Payments received', money(total(postedPay)), `${postedPay.length} posted receipts`, 'green'],
    ['Cash balance', money(cashTotal), `${cashBalances.length} cash account(s)`, 'gold'],
    ['Bank balance', money(bankTotal), `${bankBalances.length} bank account(s)`, 'purple'],
    ['Outstanding', money(total(outstanding.map(i=>({amount:i.outstanding})))), `${outstanding.length} invoice(s) pending`, 'cyan'],
    ['Overdue invoices', money(total(overdue.map(i=>({amount:i.outstanding})))), `${overdue.length} older than 30 days`, 'red'],
    ['Total expenses', money(total(postedExp)), `${postedExp.length} posted expenses`, 'orange'],
    ['Net cash movement', money(total(postedPay)-total(postedExp)), 'Receipts less expenses', 'teal']
  ];
  const now = new Date();
  const months = Array.from({length:6}, (_, i) => new Date(now.getFullYear(), now.getMonth()-5+i, 1));
  const monthly = months.map(d => {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const income = postedPay.filter(r => String(r.payment_date||'').slice(0,7)===key).reduce((sum,r)=>sum+Number(r.amount||0),0);
    const expenses = postedExp.filter(r => String(r.expense_date||'').slice(0,7)===key).reduce((sum,r)=>sum+Number(r.amount||0),0);
    return {label:d.toLocaleDateString('en-IN',{month:'short'}), income, expenses};
  });
  const maxValue = Math.max(1, ...monthly.flatMap(m => [m.income,m.expenses]));
  const graph = `<div class="monthly-chart" role="img" aria-label="Monthly posted income and expenses for the last six months">${monthly.map(m=>`<div class="chart-month"><div class="chart-bars"><span class="chart-bar income" title="Income ${money(m.income)}" style="height:${Math.max(m.income?3:0,m.income/maxValue*100)}%"></span><span class="chart-bar expense" title="Expenses ${money(m.expenses)}" style="height:${Math.max(m.expenses?3:0,m.expenses/maxValue*100)}%"></span></div><span class="chart-label">${escapeHtml(m.label)}</span></div>`).join('')}</div><div class="chart-legend"><span><i class="legend-dot income"></i> Income</span><span><i class="legend-dot expense"></i> Expenses</span></div>`;
  const expenseTotal = total(postedExp), incomeTotal = total(postedPay), profit = incomeTotal-expenseTotal;
  const incomeShare = incomeTotal+expenseTotal ? Math.round(incomeTotal/(incomeTotal+expenseTotal)*100) : 0;
  const recent = [
    ...validInv.map(r=>({date:r.created_at||r.invoice_date,label:`Invoice ${r.invoice_no||''}`,detail:r.client_name_snapshot||'Invoice created',amount:Number(r.total||0),kind:'invoice'})),
    ...postedPay.map(r=>({date:r.created_at||r.payment_date,label:'Payment received',detail:r.payment_date||'Receipt posted',amount:Number(r.amount||0),kind:'payment'})),
    ...postedExp.map(r=>({date:r.created_at||r.expense_date,label:'Expense recorded',detail:r.expense_date||'Expense posted',amount:Number(r.amount||0),kind:'expense'}))
  ].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,7);
  const overdueRows = overdue.slice(0,6).map(i=>`<tr><td>${escapeHtml(i.invoice_no||'—')}</td><td>${escapeHtml(i.client_name_snapshot||'—')}</td><td>${date(i.invoice_date)}</td><td><strong class="amount-alert">${money(i.outstanding)}</strong></td></tr>`);
  $('#page-content').innerHTML = `
    <section class="welcome-banner"><div class="welcome-identity">${avatarHtml}<div><div class="eyebrow">AVENIX OVERSEAS · FINANCIAL INTELLIGENCE</div><h2>Welcome back, ${welcomeName}</h2><p>Your business at a glance — live summaries from posted accounting records.</p><div class="welcome-tags"><span>● Financial overview</span><span>● ${isAdmin()?'Administrator access':'Authorized view'}</span></div></div></div><div class="welcome-date">${escapeHtml(dateTimeIST(new Date()))}</div></section>
    <div class="stats-grid dashboard-stats dashboard-stats-expanded">${stats.map(([label,value,sub,tone]) => `<article class="stat-card tone-${tone}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>`).join('')}</div>
    <div class="dashboard-grid dashboard-grid-top">${panel('Monthly income & expenses', `<p class="panel-subtitle">Posted receipts and expenses · last 6 months</p>${graph}`)}
    ${panel('Business health', `<div class="health-layout"><div class="health-gauge" style="--health:${Math.max(0,Math.min(100,incomeShare))}%"><div class="health-gauge-inner"><strong>${incomeShare}</strong><span>Income share</span></div></div><div class="health-legend"><div><i class="legend-dot income"></i><span>Income received</span><strong>${money(incomeTotal)}</strong></div><div><i class="legend-dot expense"></i><span>Expenses paid</span><strong>${money(expenseTotal)}</strong></div><div class="health-profit"><span>Net movement</span><strong>${money(profit)}</strong></div></div></div><div class="health-meter"><div><span>Cash + bank reserves</span><strong>${money(cashTotal+bankTotal)}</strong></div><div class="meter-track"><span style="width:${Math.max(3,Math.min(100,(cashTotal+bankTotal)/(Math.max(1,incomeTotal+expenseTotal))*100))}%"></span></div><small>Compared with recent posted receipts and expenses</small></div>`)}</div>
    <div class="dashboard-grid dashboard-grid-bottom">${panel('Overdue invoices · 30+ days', overdueRows.length ? tableHtml(['Invoice','Client','Date','Outstanding'],overdueRows) : `<div class="empty-state-dashboard"><span>✓</span><strong>No overdue invoices found</strong><p>Invoices outstanding for more than 30 days will appear here.</p></div>`)}
    ${panel('Recent activity', `<div class="activity-feed">${recent.length?recent.map(r=>`<div class="activity-row"><span class="activity-icon ${r.kind}">${r.kind==='invoice'?'▤':r.kind==='payment'?'↙':'↗'}</span><div class="activity-copy"><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(String(r.detail||''))}</small></div><div class="activity-amount"><strong>${money(r.amount)}</strong><small>${r.date?date(String(r.date).slice(0,10)):'Recent'}</small></div></div>`).join(''):`<div class="empty-state-dashboard"><strong>No recent activity yet</strong><p>Invoices, payments, and expenses will appear here.</p></div>`}</div>`)}</div>
    ${panel('Cash & bank balances', `<div class="notice">Balances include opening balances, posted receipts, posted expenses and transfers. Transfers are not counted as new income.</div>${tableHtml(['Account','Type','Opening balance','Current balance'], [...cashBalances.map(x=>`<tr><td>${escapeHtml(x.account.name)}</td><td><span class="type-pill cash-pill">Cash</span></td><td>${money(x.openingBalance)}</td><td><strong>${money(x.currentBalance)}</strong></td></tr>`),...bankBalances.map(x=>`<tr><td>${escapeHtml(x.account.account_label || x.account.bank_name)} (${mask(x.account.account_number)})</td><td><span class="type-pill bank-pill">Bank</span></td><td>${money(x.openingBalance)}</td><td><strong>${money(x.currentBalance)}</strong></td></tr>`)])}`)}
    ${panel('Recent invoices', tableHtml(['Bill number','Date','Client','Total','Status','View'], validInv.slice(0,8).map(i=>`<tr><td>${escapeHtml(i.invoice_no)}</td><td>${date(i.invoice_date)}</td><td>${escapeHtml(i.client_name_snapshot||'—')}</td><td>${money(i.total)}</td><td>${statusPill(i.status)}</td><td><button class="icon-btn" type="button" data-dashboard-invoice="${escapeHtml(i.id)}" title="View invoice details" aria-label="View invoice details">◉</button></td></tr>`)))}
  `;
  $('#page-content').querySelectorAll('[data-dashboard-invoice]').forEach(btn => { btn.onclick = () => showInvoiceDetails(btn.dataset.dashboardInvoice); });
}
async function showInvoiceDetails(invoiceId) {
  try {
    const { data: invoice, error } = await requireClient().from('invoices')
      .select('*')
      .eq('id', invoiceId).single();
    if (error) throw error;
    const { data: payments, error: paymentError } = await requireClient().from('payments')
      .select('*')
      .eq('invoice_id', invoiceId).order('payment_date', { ascending: true });
    if (paymentError) throw paymentError;
    const validPayments = (payments || []).filter(p => isPostedFinancialStatus(p.status));
    const paid = validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const detailDialog = document.querySelector('#detail-dialog');
    document.querySelector('#detail-title').textContent = `Invoice ${invoice.invoice_no || ''}`;
    document.querySelector('#detail-content').innerHTML = `
      <div class="detail-grid">
        ${[['Client', invoice.client_name_snapshot || '—'], ['Invoice date', date(invoice.invoice_date)], ['Status', invoice.status || '—'], ['Invoice total', money(invoice.total)], ['Paid to date', money(paid)], ['Outstanding', money(Math.max(0, Number(invoice.total || 0) - paid))]].map(([label, value]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong></div>`).join('')}
      </div>
      <h3 class="detail-subtitle">Payment receipts</h3>
      ${tableHtml(['Receipt', 'Date', 'Method', 'Amount', 'Status'], validPayments.map(p => `<tr><td>${escapeHtml(p.receipt_no || '—')}</td><td>${date(p.payment_date)}</td><td>${escapeHtml(p.method || p.payment_method || '—')}</td><td>${money(p.amount)}</td><td>${statusPill(p.status)}</td></tr>`))}
    `;
    detailDialog.showModal();
  } catch (error) {
    console.error('Invoice detail lookup failed', error);
    toast('Could not load invoice details. Check invoice and payment read permissions.');
  }
}

/* ===================== CLIENTS ===================== */
async function clients() {
  const data = await query('clients');
  const add = `<button class="primary" id="add-record">+ Add client</button>`;
  $('#page-content').innerHTML = panel('Client directory',
    searchToolbar('Search name or passport', add) +
    tableHtml(['Client', 'Passport', 'Phone', 'Destination', 'Created', 'Actions'],
      data.map(r => `<tr><td>${escapeHtml(r.full_name || '—')}</td><td>${escapeHtml(mask(r.passport_number))}</td><td>${escapeHtml(r.phone || '—')}</td><td>${escapeHtml(r.destination_country || '—')}</td><td>${date(r.created_at?.slice(0, 10))}</td><td class="row-actions">${actionIcon('view', r.id)}${actionIcon('edit', r.id)}${actionIcon('delete', r.id)}</td></tr>`)
    ).replace('<table>', '<table id="records-table">')
  );
  wireSearch();
  $('#records-table').querySelectorAll('[data-action]').forEach(b => b.onclick = async () => {
    const r = data.find(x => x.id === b.dataset.id); if (!r) return;
    if (b.dataset.action === 'view') return showRecordDetails('Client details', [['Name',r.full_name],['Passport number',r.passport_number],['Contact',r.phone],['Email',r.email],['Address',r.address],['State',r.state],['Destination country',r.destination_country],['Notes',r.notes]]);
    if (b.dataset.action === 'edit') return openClientForm(r);
    if (b.dataset.action === 'delete') {
      if (!confirm(`Delete client ${r.full_name || ''}? This will not delete financial history. If invoices are linked, the database may prevent deletion.`)) return;
      const { error } = await requireClient().from('clients').delete().eq('id', r.id);
      if (error) { alert(`Client was not deleted. This client may have linked invoices and cannot be deleted. Financial history is preserved.\n\n${friendlyError(error)}`); return; }
      toast('Client deleted.'); await navigate('clients');
    }
  });
  $('#add-record').onclick = () => openClientForm();
}
function openClientForm(r = null) {
  const full = String(r?.full_name || '').trim().split(/\s+/);
  const surname = full.length > 1 ? full.pop() : '';
  const first = full.join(' ') || (r?.full_name || '');
  openForm({ title: r ? 'Edit client' : 'Add client', fields: [
    { name: 'first_name', label: 'Name', required: true, value: first, pattern: "[A-Za-zÀ-ž][A-Za-zÀ-ž .'-]*", title: 'Use letters, spaces, apostrophes or hyphens.' },
    { name: 'surname', label: 'Surname', required: true, value: surname, pattern: "[A-Za-zÀ-ž][A-Za-zÀ-ž .'-]*", title: 'Use letters, spaces, apostrophes or hyphens.' },
    { name: 'passport_number', label: 'Passport number', required: true, value: r?.passport_number || '' },
    { name: 'phone', label: 'Contact number', required: true, type: 'tel', value: r?.phone || '', pattern: '\\+?[0-9]{7,15}', title: 'Enter 7–15 digits, with an optional + at the beginning. No spaces or other symbols.' },
    { name: 'email', label: 'Email', type: 'email', required: true, value: r?.email || '' },
    { name: 'address', label: 'Address', required: true, wide: true, value: r?.address || '' },
    { name: 'state', label: 'State', value: r?.state || '' },
    { name: 'destination_country', label: 'Destination country', value: r?.destination_country || '' },
    { name: 'purpose', label: 'Purpose', type: 'select', required: true, options: [{value:'Visit',label:'Visit'},{value:'Student',label:'Student'},{value:'Tourist',label:'Tourist'},{value:'Work',label:'Work'}].map(o=>({...o,selected:o.value===(r?.purpose||'')})) },
    { name: 'notes', label: 'Additional notes', type: 'textarea', wide: true, value: r?.notes || '' }
  ], submit: async d => {
    const phone = d.phone.trim();
    if (!/^\+?[0-9]{7,15}$/.test(phone)) throw new Error('Contact number must contain 7–15 digits and may start with +. Do not use spaces or other symbols.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) throw new Error('Enter a valid email address.');
    const payload = { full_name: `${d.first_name.trim()} ${d.surname.trim()}`.trim(), passport_number: d.passport_number.trim(), phone, email: d.email.trim(), address: d.address.trim(), state: d.state.trim() || null, destination_country: d.destination_country.trim() || null, purpose: d.purpose || null, notes: d.notes.trim() || null };
    const result = r ? await requireClient().from('clients').update(payload).eq('id', r.id) : await requireClient().from('clients').insert({ ...payload, created_by: session.user.id });
    if (result.error) throw result.error;
    await navigate('clients');
    if (!r) showRecordDetails('Thank you!', [['Message', 'Thank you Client details have been added']]);
    else toast('Client updated.');
  }});
  const phoneInput = document.querySelector('#record-dialog input[name="phone"]');
  phoneInput?.addEventListener('input', () => {
    const raw = phoneInput.value;
    const hasLeadingPlus = raw.trimStart().startsWith('+');
    phoneInput.value = (hasLeadingPlus ? '+' : '') + raw.replace(/\D/g, '');
  });
}

/* ===================== SUB-AGENTS ===================== */
async function agents() {
  const data = await query('sub_agents');
  $('#page-content').innerHTML = panel('Sub-agents', searchToolbar('Search name or code', `<button class="primary" id="add-record">+ Add sub-agent</button>`) +
    tableHtml(['Name', 'Agent code', 'Phone', 'Email', 'Created', 'Actions'], data.map(r => `<tr><td>${escapeHtml(r.full_name || r.name || '—')}</td><td>${escapeHtml(r.agent_code || r.account_no || '—')}</td><td>${escapeHtml(r.phone || '—')}</td><td>${escapeHtml(r.email || '—')}</td><td>${date(r.created_at?.slice(0, 10))}</td><td class="row-actions">${actionIcon('view',r.id)}${actionIcon('edit',r.id)}${actionIcon('delete',r.id)}</td></tr>`)).replace('<table>', '<table id="records-table">'));
  wireSearch();
  $('#records-table').querySelectorAll('[data-action]').forEach(b => b.onclick = async () => {
    const r = data.find(x => x.id === b.dataset.id); if (!r) return;
    if (b.dataset.action === 'view') return showRecordDetails('Sub-agent details', [['Name',r.full_name || r.name],['Agent code',r.agent_code || r.account_no],['Phone',r.phone],['Email',r.email],['Created',date(r.created_at?.slice(0,10))]]);
    if (b.dataset.action === 'edit') return openAgentForm(r);
    if (b.dataset.action === 'delete') { if (!confirm(`Delete sub-agent ${r.full_name || r.name || ''}? Linked financial history must be preserved.`)) return; const {error}=await requireClient().from('sub_agents').delete().eq('id',r.id); if(error){alert(`Sub-agent was not deleted. It may have linked records or deletion may be restricted.\n\n${friendlyError(error)}`);return;} toast('Sub-agent deleted.'); await navigate('sub_agents'); }
  });
  $('#add-record').onclick = () => openAgentForm();
}
function openAgentForm(r = null) {
  openForm({ title: r ? 'Edit sub-agent' : 'Add sub-agent', fields: [
    { name: 'full_name', label: 'Name and surname', required: true, value: r?.full_name || r?.name || '', pattern: "[A-Za-zÀ-ž][A-Za-zÀ-ž .'-]*" },
    ...(r ? [{ name: 'agent_code', label: 'Agent code (automatically assigned)', value: r?.agent_code || r?.account_no || '', readonly: true }] : []),
    { name: 'phone', label: 'Phone', type: 'tel', value: r?.phone || '', pattern: '[+0-9() -]{7,20}' },
    { name: 'email', label: 'Email', type: 'email', value: r?.email || '' }
  ], submit: async d => { const payload={full_name:d.full_name.trim(),phone:d.phone.trim()||null,email:d.email.trim()||null}; const result=r?await requireClient().from('sub_agents').update(payload).eq('id',r.id):await requireClient().from('sub_agents').insert({...payload,created_by:session.user.id}); if(result.error)throw result.error; toast(r?'Sub-agent updated.':'Sub-agent added.'); await navigate('sub_agents'); }});
}

function actionIcon(action, id) {
  const icons = {
    view: ['View','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>'],
    edit: ['Edit','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>'],
    delete: ['Delete','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>']
  };
  const [label,glyph] = icons[action] || icons.view;
  return `<button type="button" class="icon-btn action-${action}" data-action="${action}" data-id="${escapeHtml(id)}" title="${label}" aria-label="${label}">${glyph}</button>`;
}
function showRecordDetails(title, fields) {
  let dlg = document.querySelector('#simple-detail-dialog');
  if (!dlg) { dlg=document.createElement('dialog'); dlg.id='simple-detail-dialog'; dlg.className='detail-dialog'; document.body.appendChild(dlg); }
  dlg.innerHTML = `<div class="dialog-head"><h2>${escapeHtml(title)}</h2><button class="icon-btn" type="button" data-close aria-label="Close" title="Close">✕</button></div><div class="detail-content"><div class="detail-grid">${fields.map(([k,v])=>`<div class="detail-item"><small>${escapeHtml(k)}</small><strong>${escapeHtml(String(v ?? '—') || '—')}</strong></div>`).join('')}</div></div><div class="dialog-actions"><button class="secondary" type="button" data-close>Close</button></div>`;
  dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dlg.close()); dlg.showModal();
}

/* ===================== INVOICES (enhanced) ===================== */
async function invoices() {
  const [data, paymentsData] = await Promise.all([
    queryAll('invoices', '*', 'created_at'),
    queryAll('payments', 'id,invoice_id,amount,status', 'payment_date')
  ]);
  const receivedByInvoice = new Map();
  paymentsData.filter(p => isPostedFinancialStatus(p.status)).forEach(p => { if (p.invoice_id) receivedByInvoice.set(p.invoice_id, (receivedByInvoice.get(p.invoice_id) || 0) + Number(p.amount || 0)); });
  $('#page-content').innerHTML = panel('Bills & invoices',
    searchToolbar('Search bill number, client name or status', `<button class="primary" id="add-record">+ Create bill</button>`) +
    tableHtml(['Bill number', 'Client', 'Invoice date', 'Invoice total', 'Received', 'Balance due', 'Status', 'Actions'],
      data.map(r => { const received = receivedByInvoice.get(r.id) || 0; const balance = Math.max(0, Number(r.total || 0) - received); return `<tr>
        <td>${escapeHtml(r.invoice_no)}</td>
        <td>${escapeHtml(r.client_name_snapshot || '—')}</td>
        <td>${date(r.invoice_date)}</td>
        <td>${money(r.total)}</td>
        <td>${money(received)}</td>
        <td><strong>${money(balance)}</strong></td>
        <td>${statusPill(r.status)}</td>
        <td class="row-actions"><button class="icon-btn" type="button" data-invoice-view="${r.id}" title="View invoice" aria-label="View invoice">👁</button><button class="icon-btn" type="button" data-print="${r.id}" title="Print invoice" aria-label="Print invoice">⎙</button></td>
      </tr>`; })
    ).replace('<table>', '<table id="records-table">')
  );
  wireSearch();
  $('#records-table').querySelectorAll('[data-invoice-view]').forEach(b => b.onclick = () => showInvoiceDetails(b.dataset.invoiceView));

  $('#add-record').onclick = async () => {
    const clients = await query('clients', 'id,full_name,passport_number,phone,address,destination_country,state,notes', 'full_name');
    openInvoiceForm({
      clients,
      onSubmit: async payload => {
        // The database function is the only supported invoice-write path: it creates
        // invoice rows and balanced journal entries atomically under SECURITY DEFINER.
        const { error } = await requireClient().rpc('create_invoice', {
          p_client_id: payload.client_id,
          p_invoice_date: payload.invoice_date,
          p_items: payload.items.map(i => ({
            description: i.description,
            quantity: Number(i.quantity),
            rate: Number(i.rate)
          }))
        });
        if (error) {
          console.error('create_invoice RPC failed', error);
          throw new Error(`Invoice was not created: ${error.message || 'database function failed'}`);
        }
        toast('Bill created successfully.');
        await navigate('invoices');
      }
    });
  };

  // Print handlers
  $('#records-table').querySelectorAll('[data-print]').forEach(btn => {
    btn.onclick = async () => {
      try {
        let data;
        // Prefer the print view
        const { data: viewData, error: viewErr } = await requireClient()
          .from('invoice_print_view')
          .select('*')
          .eq('id', btn.dataset.print)
          .maybeSingle();

        if (!viewErr && viewData) {
          data = viewData;
        } else {
          // Fallback: load invoice + items + client
          const { data: inv, error } = await requireClient()
            .from('invoices')
            .select('*, invoice_items(*)')
            .eq('id', btn.dataset.print)
            .single();
          if (error) throw error;
          let client = null;
          if (inv.client_id) {
            const { data: c } = await requireClient().from('clients').select('*').eq('id', inv.client_id).maybeSingle();
            client = c;
          }
          data = {
            ...inv,
            items: inv.invoice_items || inv.items || [],
            client_name_snapshot: inv.client_name_snapshot || client?.full_name,
            passport_number: client?.passport_number,
            destination_country: client?.destination_country,
            client_address: client?.address,
            purpose: inv.purpose || inv.job_description || inv.paying_for_country || client?.purpose || client?.notes
          };
        }

        // Enrich print-view snapshots from the linked client only where the invoice view
        // does not already contain a historical snapshot. The client form's Purpose / notes
        // field is stored as clients.notes in this project.
        if (data.client_id) {
          try {
            const { data: linkedClient, error: linkedClientError } = await requireClient()
              .from('clients').select('full_name,passport_number,destination_country,address,notes')
              .eq('id', data.client_id).maybeSingle();
            if (!linkedClientError && linkedClient) {
              data.client_name_snapshot = data.client_name_snapshot || linkedClient.full_name;
              data.passport_number = data.passport_number || linkedClient.passport_number;
              data.destination_country = data.destination_country || linkedClient.destination_country;
              data.client_address = data.client_address || linkedClient.address;
              data.purpose = data.purpose || linkedClient.purpose || linkedClient.notes;
            }
          } catch (clientLookupError) {
            console.warn('Could not enrich optional invoice client fields.', clientLookupError);
          }
        }

        await logDownload('invoice', data.id, 'print');

        // Prefer current company settings for the printed document, with safe config fallbacks.
        let companySettings = null;
        try {
          const { data: settingsRow, error: settingsError } = await requireClient()
            .from('company_settings')
            .select('company_name,address,website,email,secondary_email,mobile,gstin,payment_instructions')
            .limit(1)
            .maybeSingle();
          if (!settingsError) companySettings = settingsRow;
        } catch (settingsErr) {
          console.warn('Company settings unavailable for invoice print', settingsErr);
        }
        const printCompany = {
          ...COMPANY,
          name: companySettings?.company_name || COMPANY.name,
          address: companySettings?.address || COMPANY.address,
          website: companySettings?.website || COMPANY.website,
          emails: [companySettings?.email || COMPANY.emails[0], companySettings?.secondary_email || COMPANY.emails[1]],
          mobile: companySettings?.mobile || COMPANY.mobile,
          gstin: companySettings?.gstin || COMPANY.gstin || ''
        };

        // Prepare print data
        const items = (data.items || data.invoice_items || []).map(i => ({
          description: i.description,
          quantity: i.quantity,
          rate: i.rate,
          amount: i.amount != null ? i.amount : +(Number(i.quantity) * Number(i.rate)).toFixed(2)
        }));
        const subtotal = data.subtotal != null ? Number(data.subtotal) : items.reduce((s, i) => s + Number(i.amount || 0), 0);
        const total = data.total != null ? Number(data.total) : subtotal;
        // Derive tax from the persisted subtotal/total so the printed bill cannot
        // silently show an 18% tax amount that disagrees with the database total.
        const gst = Math.max(0, +(total - subtotal).toFixed(2));

        const now = new Date();
        // Print the invoice date/time only once, in Indian Standard Time.
        // Example: 17 Oct 2026, 02:50AM IST
        const dateDisplay = data.created_at
          ? `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(data.created_at))}, ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(data.created_at)).replace(/\s*(am|pm)\b/i, m => m.trim().toUpperCase()).replace(/(AM|PM)$/i, '$1')} IST`
          : date(data.invoice_date || now);

        let paymentMethod = '';
        let paymentNote = String(data.payment_note || data.notes || '').trim();
        let amountReceived = 0;
        try {
          const { data: receiptRows, error: receiptError } = await requireClient().from('payments').select('payment_date,amount,notes,reference,receipt_no,status,payment_method,method').eq('invoice_id', data.id).order('payment_date', { ascending: true });
          if (!receiptError) {
            const postedReceipts = (receiptRows || []).filter(r => isPostedFinancialStatus(r.status));
            amountReceived = postedReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
            paymentMethod = [...new Set(postedReceipts.map(r => r.payment_method || r.method).filter(Boolean))].join(', ');
            // Only the latest user-written payment note (not receipt list)
            const notesOnly = postedReceipts.map(r => String(r.notes || '').trim()).filter(Boolean);
            if (notesOnly.length && !paymentNote) paymentNote = notesOnly[notesOnly.length - 1];
          }
        } catch (noteError) { console.warn('Could not load payment notes for invoice print.'); }
        const balanceDue = Math.max(0, Number(total || 0) - amountReceived);

        printInvoice({
          invoice_no: data.invoice_no,
          invoice_date: data.invoice_date,
          date_display: dateDisplay,
          client_name: data.client_name_snapshot || data.client_name,
          client_first_name: data.client_first_name,
          client_surname: data.client_surname,
          passport_number: data.passport_number,
          destination_country: data.destination_country,
          purpose: data.purpose || data.job_description || data.paying_for_country || data.notes || '',
          client_address: data.client_address || data.address,
          items,
          subtotal,
          gst,
          total,
          payment_method: paymentMethod,
          payment_note: paymentNote,
          amount_received: amountReceived,
          balance_due: balanceDue,
          sgst_rate: data.sgst_rate ?? data.sgst_percent,
          cgst_rate: data.cgst_rate ?? data.cgst_percent,
          sgst_amount: data.sgst_amount,
          cgst_amount: data.cgst_amount,
          discount_amount: data.discount_amount ?? data.discount,
          authorized_signatory: data.authorized_signatory || 'Rohit Rawat',
          signatory_designation: data.signatory_designation || 'MD',
          company: printCompany,
          received_by: profile?.display_name || session?.user?.email || '—'
        });
      } catch (e) {
        console.error(e);
        toast('Unable to load bill details for printing.');
      }
    };
  });
}

/* ===================== PAYMENTS ===================== */
async function payments() {
  const data = await query('payments');
  const creatorIds = [...new Set(data.map(x=>x.created_by).filter(Boolean))]; let creatorMap = new Map();
  if (creatorIds.length) { try { const {data:people}=await requireClient().from('profile_directory').select('id,display_name').in('id',creatorIds); creatorMap=new Map((people||[]).map(p=>[String(p.id),p.display_name])); } catch {} }
  const add = `<button class="primary" id="add-record">+ Record payment</button>`;
  $('#page-content').innerHTML = panel('Payments & receipts',
    searchToolbar('Search receipt or client', add) +
    tableHtml(['Receipt', 'Date', 'Amount', 'Method', 'Entered by', 'Status', 'Actions'],
      data.map(r => `<tr>
        <td>${escapeHtml(r.receipt_no || r.id?.slice(0, 8))}</td>
        <td>${date(r.payment_date)}</td><td>${money(r.amount)}</td>
        <td>${escapeHtml(r.payment_method || r.method || '—')}</td><td>${escapeHtml(creatorMap.get(String(r.created_by))||'—')}</td>
        <td>${statusPill(r.status)}</td><td class="row-actions"><button type="button" class="icon-btn" data-payment-view="${r.id}" title="View receipt" aria-label="View receipt">👁</button><button type="button" class="icon-btn" data-payment-print="${r.id}" title="Print payment receipt and installment history" aria-label="Print receipt">⎙</button>${actionIcon('edit',r.id)}${actionIcon('delete',r.id)}</td>
      </tr>`)
    ).replace('<table>', '<table id="records-table">')
  );
  wireSearch();
  $('#records-table').querySelectorAll('[data-payment-view]').forEach(b => { const r=data.find(x=>x.id===b.dataset.paymentView); b.onclick=()=>showRecordDetails('Payment receipt', [['Receipt',r?.receipt_no],['Date',date(r?.payment_date)],['Invoice',r?.invoice_id],['Amount',money(r?.amount)],['Method',r?.payment_method||r?.method],['Reference',r?.reference],['Received by',creatorMap.get(String(r?.created_by))||r?.receiver_name],['Payment notes',r?.notes],['Status',r?.status]]); });
  $('#records-table').querySelectorAll('[data-payment-print]').forEach(b => { const r=data.find(x=>x.id===b.dataset.paymentPrint); b.onclick=()=>printPaymentReceipt(r); });
  $('#records-table').querySelectorAll('[data-action="edit"]').forEach(b => { const r=data.find(x=>x.id===b.dataset.id); b.onclick=()=>openPaymentForm(r); });
  $('#records-table').querySelectorAll('[data-action="delete"]').forEach(b => { const r=data.find(x=>x.id===b.dataset.id); b.onclick=async()=>{ if(!r||!confirm('Void this receipt? The system will preserve the receipt and reverse its accounting entry instead of permanently deleting financial history.'))return; const {error}=await requireClient().rpc('void_invoice_payment',{p_payment_id:r.id,p_reason:'Voided from Payments & Receipts'}); if(error){alert(`Receipt could not be voided. Apply the Avenix SQL setup first if the void function is missing.\n\n${friendlyError(error)}`);return;} toast('Receipt voided and accounting reversal posted.'); await navigate('payments'); }; });
  $('#add-record').onclick = () => openPaymentForm();
}

async function openPaymentForm(r = null) {
  const [allInvoices, existingPayments, cashAccounts, bankAccounts] = await Promise.all([
    queryAll('invoices', 'id,invoice_no,total,client_name_snapshot,status', 'invoice_date'),
    queryAll('payments', 'id,invoice_id,amount,status', 'payment_date'),
    query('cash_accounts', 'id,name,active', 'name'), query('bank_accounts', 'id,bank_name,account_label,active', 'bank_name')
  ]);
  const paidByInvoice = new Map();
  existingPayments.filter(p=>isPostedFinancialStatus(p.status) && p.id!==r?.id).forEach(p=>{if(p.invoice_id)paidByInvoice.set(p.invoice_id,(paidByInvoice.get(p.invoice_id)||0)+Number(p.amount||0));});
  const invoices = allInvoices.map(i=>({...i,outstanding:Math.max(0,Number(i.total||0)-(paidByInvoice.get(i.id)||0))})).filter(i=>!/(void|cancel|revers|draft)/i.test(String(i.status||'')) && (r ? i.id===r.invoice_id : i.outstanding>0.005));
  if(!invoices.length){toast('No outstanding invoice is available. Create a bill first.');return;}
  const destinations=[
    ...cashAccounts.filter(a=>a.active!==false).map(a=>({value:`cash:${a.id}`,label:`Cash — ${a.name}`,selected:r?.account_type==='cash'&&String(r?.account_id)===String(a.id)})),
    ...bankAccounts.filter(a=>a.active!==false).map(a=>({value:`bank:${a.id}`,label:`Bank — ${a.account_label||a.bank_name}`,selected:r?.account_type==='bank'&&String(r?.account_id)===String(a.id)}))
  ];
  const methodOptions=[{value:'cash',label:'Cash'},{value:'bank_transfer',label:'Bank transfer'},{value:'upi',label:'UPI'},{value:'cheque',label:'Cheque'},{value:'card',label:'Card'},{value:'other',label:'Other'}].map(o=>({...o,selected:o.value===(r?.payment_method||r?.method||'cash')}));
  openForm({title:r?'Edit payment receipt':'Record payment',fields:[
    {name:'invoice_id',label:'Original invoice',type:'select',required:true,options:invoices.map(i=>({value:i.id,label:`${i.invoice_no} — ${i.client_name_snapshot||''} · Due ${money(i.outstanding)}`,selected:i.id===r?.invoice_id}))},
    {name:'payment_date',label:'Payment date',type:'date',required:true,value:r?.payment_date||localDateISO()},
    {name:'amount',label:'Amount received (₹)',type:'number',required:true,min:0.01,step:'0.01',value:r?.amount??''},
    {name:'payment_method',label:'Payment method',type:'select',required:true,options:methodOptions},
    {name:'destination',label:'Received into account',type:'select',required:true,options:destinations},
    {name:'reference',label:'Reference / Transaction ID',required:true,value:r?.reference||''},
    {name:'notes',label:'Payment notes',type:'textarea',wide:true,value:r?.notes||''}
  ],submit:async d=>{
    const [destination_type,destination_id]=String(d.destination||'').split(':');
    if(!destination_type||!destination_id)throw new Error('Select a valid receiving account.');
    if(r){const {error}=await requireClient().rpc('edit_invoice_payment',{p_payment_id:r.id,p_payment_date:d.payment_date,p_amount:Number(d.amount),p_method:d.payment_method,p_destination_type:destination_type,p_destination_id:destination_id,p_reference:d.reference.trim(),p_notes:d.notes||null});if(error)throw new Error(`Receipt was not updated: ${error.message}`);}
    else {const {error}=await requireClient().rpc('record_invoice_payment',{p_invoice_id:d.invoice_id,p_payment_date:d.payment_date,p_amount:Number(d.amount),p_method:d.payment_method,p_destination_type:destination_type,p_destination_id:destination_id,p_receiver_name:profile?.display_name||session.user.email,p_reference:d.reference.trim(),p_notes:d.notes||null});if(error)throw new Error(`Payment was not recorded: ${error.message}`);}
    toast(r?'Receipt updated; accounting history preserved.':'Payment recorded.');await navigate('payments');
  }});
}

async function printPaymentReceipt(payment) {
  if (!payment) return;
  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups to print the payment receipt.'); return; }
  win.document.write('<!doctype html><title>Loading payment receipt…</title><p style="font:16px Arial;padding:24px">Preparing receipt…</p>');
  try {
    const [invoiceResult, historyResult] = await Promise.all([
      requireClient().from('invoices').select('id,invoice_no,invoice_date,client_id,client_name_snapshot,total,subtotal,sgst_amount,cgst_amount,status').eq('id',payment.invoice_id).single(),
      requireClient().from('payments').select('id,receipt_no,payment_date,amount,payment_method,method,reference,notes,status,receiver_name,created_by').eq('invoice_id',payment.invoice_id).order('payment_date',{ascending:true})
    ]);
    if (invoiceResult.error) throw invoiceResult.error;
    if (historyResult.error) throw historyResult.error;
    const invoice=invoiceResult.data; const history=(historyResult.data||[]).filter(p=>isPostedFinancialStatus(p.status));
    let clientDetails = null;
    if (invoice.client_id) {
      try {
        const {data:client,error:clientError}=await requireClient().from('clients').select('*').eq('id',invoice.client_id).maybeSingle();
        if(!clientError) clientDetails=client;
      } catch {}
    }
    const clientFirst = clientDetails?.first_name || clientDetails?.name || '';
    const clientSurname = clientDetails?.surname || clientDetails?.last_name || '';
    const clientFullName = [clientFirst,clientSurname].filter(Boolean).join(' ') || invoice.client_name_snapshot || 'Client';
    const clientFields = [
      ['Name',clientFirst || (clientFullName.split(/\s+/)[0]||'—')], ['Surname',clientSurname || (clientFullName.split(/\s+/).slice(1).join(' ')||'—')],
      ['Passport No.',clientDetails?.passport_number || clientDetails?.passport_no || '—'],
      ['Destination Country',clientDetails?.destination_country || '—'], ['Purpose',clientDetails?.purpose || clientDetails?.job_description || clientDetails?.paying_for_country || '—'],
      ['Client Address',clientDetails?.client_address || clientDetails?.address || '—']
    ];
    let receiptCompany={...COMPANY};
    try { const {data:cs,error:csError}=await requireClient().from('company_settings').select('company_name,address,email,secondary_email,mobile,gstin,website,payment_instructions').limit(1).maybeSingle(); if(!csError&&cs){receiptCompany={...receiptCompany,name:cs.company_name||receiptCompany.name,address:cs.address||receiptCompany.address,mobile:cs.mobile||receiptCompany.mobile,emails:[cs.email||receiptCompany.emails?.[0],cs.secondary_email||receiptCompany.emails?.[1]],gstin:cs.gstin||receiptCompany.gstin,website:cs.website||receiptCompany.website,payment_instructions:cs.payment_instructions||''};} } catch {}
    const totalReceived=history.reduce((sum,p)=>sum+Number(p.amount||0),0);
    const balance=Math.max(0,Number(invoice.total||0)-totalReceived);
    const creatorIds=[...new Set(history.map(p=>p.created_by).filter(Boolean))]; let names=new Map();
    if(creatorIds.length){try{const {data:people}=await requireClient().from('profile_directory').select('id,display_name').in('id',creatorIds);names=new Map((people||[]).map(x=>[String(x.id),x.display_name]));}catch{}}
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(payment.receipt_no||'')}</title><style>@page{size:A4;margin:8mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}html,body{height:auto;max-height:277mm}body{font:10px Arial,sans-serif;color:#17253b;margin:0;padding:6px}header{border-bottom:2px solid #102b55;padding-bottom:6px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}h1{font-size:16px;margin:0;color:#102b55}h2{font-size:12px;margin:8px 0 4px;color:#102b55}p{margin:2px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0}.tile{padding:4px 6px;background:#f4f7fb;border-radius:4px}.label{font-size:8.5px;color:#60708a;text-transform:uppercase;letter-spacing:.02em}.value{font-weight:bold;margin-top:1px;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:4px}th,td{text-align:left;border-bottom:1px solid #dce4ef;padding:3px 5px;font-size:9px}th{background:#102b55;color:#fff}.right{text-align:right}.totals{margin:6px 0 4px auto;width:min(320px,100%)}.totals div{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #e5ebf4;font-size:10px}.balance{font-size:13px;font-weight:bold;color:${balance>0?'#b42318':'#147442'}}footer{border-top:1px solid #dce4ef;margin-top:6px;padding-top:4px;font-size:8.5px;color:#65748b}.actions{margin:8px 0}header img{width:42px;height:42px;object-fit:contain}@media print{.actions{display:none}body{margin:0;padding:0}table,header,.meta,.totals,footer{page-break-inside:avoid;break-inside:avoid}}</style></head><body>
      <header><div style="display:flex;align-items:center;gap:14px"><img src="${escapeHtml(new URL('assets/avenix-logo.png',window.location.href).href)}" alt="Avenix Overseas logo" style="width:70px;height:70px;object-fit:contain"><div><h1>AVENIX OVERSEAS</h1><p>Accounts &amp; billing</p><p>${escapeHtml(receiptCompany.address||'Delhi, India')} · ${escapeHtml(receiptCompany.emails?.[0]||'info@avenixoverseas.com')} · ${escapeHtml(receiptCompany.mobile||'')}</p></div></div><div style="text-align:right"><h1>${escapeHtml(payment.receipt_no||'PAYMENT RECEIPT')}</h1><p>Date: ${escapeHtml(date(payment.payment_date))}</p><p>Original invoice: ${escapeHtml(invoice.invoice_no||'—')}</p></div></header>
      <h2>Client details</h2><div class="meta">${clientFields.map(([label,value])=>`<div class="tile"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join('')}<div class="tile"><div class="label">Received from</div><div class="value">${escapeHtml(clientFullName)}</div></div><div class="tile"><div class="label">Payment method</div><div class="value">${escapeHtml(payment.payment_method||payment.method||'—')}</div></div><div class="tile"><div class="label">Amount received this time</div><div class="value">${escapeHtml(money(payment.amount))}</div></div><div class="tile"><div class="label">Reference / transaction ID</div><div class="value">${escapeHtml(payment.reference||'—')}</div></div></div>
      <h2>Installment history for ${escapeHtml(invoice.invoice_no||'original invoice')}</h2>
      <table><thead><tr><th>Receipt No.</th><th>Date</th><th>Method</th><th>Received by</th><th class="right">Amount</th></tr></thead><tbody>${history.map(p=>`<tr><td>${escapeHtml(p.receipt_no||'—')}</td><td>${escapeHtml(date(p.payment_date))}</td><td>${escapeHtml(p.payment_method||p.method||'—')}</td><td>${escapeHtml(names.get(String(p.created_by))||p.receiver_name||'—')}</td><td class="right">${escapeHtml(money(p.amount))}</td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span>Original invoice total</span><strong>${escapeHtml(money(invoice.total))}</strong></div><div><span>Total received to date</span><strong>${escapeHtml(money(totalReceived))}</strong></div><div><span>Payment received on this receipt</span><strong>${escapeHtml(money(payment.amount))}</strong></div><div><span>Balance outstanding</span><strong class="balance">${escapeHtml(money(balance))}</strong></div></div>
      <p><strong>Payment notes:</strong> ${escapeHtml(payment.notes||'—')}</p>${receiptCompany.payment_instructions?`<p><strong>Payment instructions:</strong> ${escapeHtml(receiptCompany.payment_instructions)}</p>`:''}<p>This is a payment receipt, not a new tax invoice. All installments are applied to the original invoice shown above.</p><footer>For any queries, contact info@avenixoverseas.com. Generated from the Avenix Overseas accounting system.</footer><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div></body></html>`);
    win.document.close();
  } catch(e) { win.close(); toast(`Unable to prepare receipt: ${friendlyError(e)}`); }
}

/* ===================== EXPENSES ===================== */
async function expenses() {
  const data = await query('expenses');
  const creatorIds = [...new Set(data.map(x => x.created_by).filter(Boolean))];
  let creatorMap = new Map();
  if (creatorIds.length) {
    try { const {data: people} = await requireClient().from('profile_directory').select('id,display_name').in('id', creatorIds); creatorMap = new Map((people || []).map(x => [x.id, x.display_name || '—'])); } catch {}
  }
  const add = `<button class="primary" id="add-record">+ Record expense</button>`;
  $('#page-content').innerHTML = panel('Expenses',
    searchToolbar('Search description or payee', add) +
    tableHtml(['Date', 'Description', 'Payee', 'Amount', 'Created by', 'Status', 'Actions'],
      data.map(r => `<tr>
        <td>${date(r.expense_date)}</td><td>${escapeHtml(r.description || '—')}</td><td>${escapeHtml(r.payee || '—')}</td>
        <td>${money(r.amount)}</td><td>${escapeHtml(creatorMap.get(r.created_by) || r.created_by_name || '—')}</td>
        <td>${statusPill(r.status)}</td><td class="row-actions">${actionIcon('view',r.id)}${actionIcon('edit',r.id)}<button type="button" class="icon-btn" data-expense-print="${r.id}" title="Print expense voucher" aria-label="Print expense voucher">⎙</button>${actionIcon('delete',r.id)}</td>
      </tr>`)
    ).replace('<table>', '<table id="records-table">')
  );
  wireSearch();
  $('#page-content').querySelectorAll('[data-expense-print]').forEach(btn => {
    btn.onclick = () => {
      const row = data.find(x => String(x.id) === String(btn.dataset.expensePrint));
      if (row) printExpenseVoucher(row, creatorMap.get(row.created_by) || row.created_by_name || '—');
    };
  });
  $('#records-table').querySelectorAll('[data-action]').forEach(b => b.onclick = async () => {
    const r = data.find(x => x.id === b.dataset.id); if (!r) return;
    if (b.dataset.action === 'view') return showRecordDetails('Expense details', [['Date',date(r.expense_date)],['Payee',r.payee],['Description',r.description],['Amount',money(r.amount)],['Payment method',r.payment_method],['Reference',r.reference],['Created by',creatorMap.get(r.created_by)||r.created_by_name],['Status',r.status]]);
    if (b.dataset.action === 'edit') return openExpenseForm(r);
    if (b.dataset.action === 'delete') {
      if (!confirm('Void this expense? Its original audit trail must be preserved; accounting entries should be reversed, not erased.')) return;
      const {error} = await requireClient().rpc('void_expense', {p_expense_id:r.id, p_reason:'Voided by user from Expenses'});
      if (error) { alert(`Expense was not voided. Apply the authoritative Supabase SQL.sql first if this function is missing.\n\n${friendlyError(error)}`); return; }
      toast('Expense voided and accounting reversal requested.'); await navigate('expenses');
    }
  });
  $('#add-record').onclick = () => openExpenseForm();
}

async function openExpenseForm(r = null) {
  const [cashAccounts, bankAccounts] = await Promise.all([
    query('cash_accounts', 'id,name,active', 'name'), query('bank_accounts', 'id,bank_name,account_label,active', 'bank_name')
  ]);
  const accounts = [
    ...cashAccounts.filter(a => a.active !== false).map(a => ({ value: `cash:${a.id}`, label: `Cash — ${a.name}`, selected:r?.account_type==='cash' && String(r?.account_id)===String(a.id) })),
    ...bankAccounts.filter(a => a.active !== false).map(a => ({ value: `bank:${a.id}`, label: `Bank — ${a.account_label || a.bank_name}`, selected:r?.account_type==='bank' && String(r?.account_id)===String(a.id) }))
  ];
  const methodOptions = [
    { value: 'cash', label: 'Cash', selected:r?.payment_method==='cash' }, { value: 'bank_transfer', label: 'Bank transfer', selected:r?.payment_method==='bank_transfer' },
    { value: 'upi', label: 'UPI', selected:r?.payment_method==='upi' }, { value: 'cheque', label: 'Cheque', selected:r?.payment_method==='cheque' }, { value: 'card', label: 'Card', selected:r?.payment_method==='card' }, { value: 'other', label: 'Other', selected:r?.payment_method==='other' }
  ];
  openForm({
    title: r ? 'Edit expense' : 'Record expense',
    fields: [
      { name: 'expense_date', label: 'Date', type: 'date', required: true, value: r?.expense_date || localDateISO() },
      { name: 'category', label: 'Category', type: 'select', required: true, options: [
        {value:'Office Expenses',label:'Office Expenses',selected:(r?.category||'Other Expenses')==='Office Expenses'},
        {value:'Travel & Conveyance',label:'Travel & Conveyance',selected:r?.category==='Travel & Conveyance'},
        {value:'Marketing & Advertising',label:'Marketing & Advertising',selected:r?.category==='Marketing & Advertising'},
        {value:'Staff Salaries',label:'Staff Salaries',selected:r?.category==='Staff Salaries'},
        {value:'Rent & Utilities',label:'Rent & Utilities',selected:r?.category==='Rent & Utilities'},
        {value:'Professional Fees',label:'Professional Fees',selected:r?.category==='Professional Fees'},
        {value:'Bank Charges',label:'Bank Charges',selected:r?.category==='Bank Charges'},
        {value:'Other Expenses',label:'Other Expenses',selected:!r?.category || r?.category==='Other Expenses' || r?.category==='Other Expense'}
      ]},
      { name: 'payee', label: 'Paid to / payee', required: true, value: r?.payee || '' },
      { name: 'description', label: 'Description', required: true, wide: true, value: r?.description || '' },
      { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0.01, step: '0.01', value: r?.amount ?? '' },
      { name: 'payment_method', label: 'Payment method', type: 'select', required: true, options: methodOptions },
      { name: 'account', label: 'Paid from account', type: 'select', required: true, options: accounts },
      { name: 'reference', label: 'Reference / voucher number', required: true, value: r?.reference || '' }
    ],
    submit: async d => {
      const [account_type, account_id] = String(d.account || '').split(':');
      if (!account_type || !account_id) throw new Error('Select a valid paying account.');
      if (r) {
        const {error} = await requireClient().rpc('edit_expense', {p_expense_id:r.id,p_expense_date:d.expense_date,p_amount:Number(d.amount),p_payee:d.payee.trim(),p_description:d.description.trim(),p_payment_method:d.payment_method,p_account_type:account_type,p_account_id:account_id,p_reference:d.reference.trim(),p_category:d.category||'Other Expenses'});
        if (error) throw new Error(`Expense was not updated: ${error.message}. If this continues, contact your administrator.`);
      } else {
        const { error } = await requireClient().rpc('record_expense', {
          p_expense_date: d.expense_date, p_amount: Number(d.amount), p_category: d.category || 'Other Expenses', p_payee: d.payee.trim(),
          p_description: d.description.trim(), p_payment_method: d.payment_method, p_account_type: account_type, p_account_id: account_id, p_reference: d.reference.trim()
        });
        if (error) throw new Error(`Expense was not recorded: ${error.message || 'database function failed'}`);
      }
      toast(r ? 'Expense updated.' : 'Expense recorded.'); await navigate('expenses');
    }
  });
}

/* ===================== CASH / BANK ACCOUNTS ===================== */
async function accounts(table) {
  const cash = table === 'cash_accounts';
  const [data, paymentsData, expensesData, transfersData, invoicesData] = await Promise.all([
    query(table),
    queryAll('payments', 'id,receipt_no,invoice_id,payment_date,amount,status,account_type,account_id,payment_method,method,reference,receiver_name,created_by,notes', 'payment_date'),
    queryAll('expenses', 'id,expense_date,amount,status,account_type,account_id,payment_method,reference,payee,description,created_by', 'expense_date'),
    queryAll('transfers', 'id,transfer_date,amount,status,source_type,source_id,destination_type,destination_id,reference,description,created_by', 'transfer_date'),
    queryAll('invoices', 'id,invoice_no,client_name_snapshot', 'invoice_date')
  ]);
  const balanceFor = r => computeAccountBalance({accountType:cash?'cash':'bank',accountId:r.id,openingBalance:r.opening_balance,payments:paymentsData,expenses:expensesData,transfers:transfersData});
  const invoiceById = new Map(invoicesData.map(i => [String(i.id), i]));
  const creatorIds = [...new Set([...paymentsData,...expensesData,...transfersData].map(x=>x.created_by).filter(Boolean))];
  let creatorMap = new Map();
  if (creatorIds.length) { try { const {data:people} = await requireClient().from('profiles').select('id,display_name,email').in('id',creatorIds); creatorMap = new Map((people||[]).map(p=>[String(p.id),p.display_name||'—'])); } catch {} }
  const accountById = new Map(data.map(a=>[String(a.id),cash?a.name:(a.account_label||a.bank_name)]));
  const statementEvents = [];
  paymentsData.filter(p=>isPostedFinancialStatus(p.status) && String(p.account_type||'').toLowerCase()===(cash?'cash':'bank')).forEach(p=>{
    const accountId=String(p.account_id||''); if(!accountById.has(accountId)) return; const inv=invoiceById.get(String(p.invoice_id));
    statementEvents.push({date:p.payment_date,accountId,description:'Payment received',reference:`${inv?.client_name_snapshot||'Client'}${inv?.invoice_no?' · '+inv.invoice_no:''}${p.receipt_no?' · '+p.receipt_no:''}`,party:p.receiver_name||'—',enteredBy:creatorMap.get(String(p.created_by))||'—',debit:0,credit:Number(p.amount||0),id:p.id});
  });
  expensesData.filter(e=>isPostedFinancialStatus(e.status) && String(e.account_type||'').toLowerCase()===(cash?'cash':'bank')).forEach(e=>{
    const accountId=String(e.account_id||''); if(!accountById.has(accountId)) return;
    statementEvents.push({date:e.expense_date,accountId,description:e.description||'Expense paid',reference:e.reference||'Expense',party:e.payee||'—',enteredBy:creatorMap.get(String(e.created_by))||'—',debit:Number(e.amount||0),credit:0,id:e.id});
  });
  transfersData.filter(t=>isPostedFinancialStatus(t.status)).forEach(t=>{
    if(String(t.source_type||'').toLowerCase()===(cash?'cash':'bank') && accountById.has(String(t.source_id))) statementEvents.push({date:t.transfer_date,accountId:String(t.source_id),description:'Transfer out',reference:t.reference||t.description||'Transfer',party:'Internal transfer',enteredBy:creatorMap.get(String(t.created_by))||'—',debit:Number(t.amount||0),credit:0,id:t.id+'-out'});
    if(String(t.destination_type||'').toLowerCase()===(cash?'cash':'bank') && accountById.has(String(t.destination_id))) statementEvents.push({date:t.transfer_date,accountId:String(t.destination_id),description:'Transfer in',reference:t.reference||t.description||'Transfer',party:'Internal transfer',enteredBy:creatorMap.get(String(t.created_by))||'—',debit:0,credit:Number(t.amount||0),id:t.id+'-in'});
  });
  statementEvents.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.id).localeCompare(String(b.id)));
  const running = new Map(data.map(a=>[String(a.id),Number(a.opening_balance||0)]));
  const statementRows = statementEvents.map((e,i)=>{const next=Number(running.get(e.accountId)||0)+e.credit-e.debit;running.set(e.accountId,next);return `<tr><td>${i+1}</td><td>${date(e.date)}</td><td>${escapeHtml(accountById.get(e.accountId)||'—')}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.reference)}</td><td>${escapeHtml(e.party)}</td><td>${escapeHtml(e.enteredBy)}</td><td class="amount">${e.debit?money(e.debit):'—'}</td><td class="amount">${e.credit?money(e.credit):'—'}</td><td class="amount"><strong>${money(next)}</strong></td></tr>`;});
  const petty = cash && data.some(a => String(a.name || '').trim().toLowerCase() === 'petty cash');
  const actions = `<button class="primary" id="add-record">+ Add account</button>${cash && !petty ? `<button class="secondary" id="setup-petty-cash">+ Set up Petty Cash</button>` : ''}`;
  const headers = cash ? ['Account', 'Location', 'Opening balance', 'Current balance', 'Status', 'Actions'] : ['Bank', 'Account label', 'Account number', 'IFSC', 'Opening balance', 'Current balance', 'Status', 'Actions'];
  $('#page-content').innerHTML = panel(cash ? 'Cash accounts' : 'Bank accounts', searchToolbar('Search account', actions) +
    tableHtml(headers, data.map(r => { const balance = balanceFor(r); return cash
      ? `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.location || '—')}</td><td>${money(balance.openingBalance)}</td><td><strong>${money(balance.currentBalance)}</strong></td><td>${r.active !== false ? 'Active' : 'Inactive'}</td><td class="row-actions">${actionIcon('view',r.id)}${actionIcon('edit',r.id)}${actionIcon('delete',r.id)}</td></tr>`
      : `<tr><td>${escapeHtml(r.bank_name)}</td><td>${escapeHtml(r.account_label || '—')}</td><td>${escapeHtml(mask(r.account_number))}</td><td>${escapeHtml(r.ifsc || '—')}</td><td>${money(balance.openingBalance)}</td><td><strong>${money(balance.currentBalance)}</strong></td><td>${r.active !== false ? 'Active' : 'Inactive'}</td><td class="row-actions">${actionIcon('view',r.id)}${actionIcon('edit',r.id)}${actionIcon('delete',r.id)}</td></tr>`; })
    ).replace('<table>', '<table id="records-table">') + panel(cash?'CASH TRANSACTION STATEMENT':'BANK TRANSACTION STATEMENT', `<div class="notice">Every posted receipt, expense and transfer appears on its own line. Running balance is opening balance + credits − debits. The Entered by column comes from the authenticated user's profile.</div>${tableHtml(['No.','Date','Account','Description','Name / Invoice / Reference','Receiver / Payee','Entered by','Debit','Credit','Balance'],statementRows)}`));
  wireSearch();
  $('#records-table').querySelectorAll('[data-action]').forEach(btn => btn.onclick = async () => {
    const r=data.find(x=>x.id===btn.dataset.id); if(!r)return;
    if(btn.dataset.action==='view') { return showAccountStatement(table, r, cash, balanceFor(r), paymentsData, expensesData, transfersData); }
    if(btn.dataset.action==='edit') return openAccountForm(table,r);
    if(btn.dataset.action==='delete') { if(String(r.name||'').toLowerCase()==='petty cash' && cash){alert('Petty Cash is a dedicated account. Deactivate it through account management only after its balance is zero and all history is reconciled.');return;} if(!confirm('Delete this account? Existing transaction history must remain intact; linked accounts may be protected by the database.'))return; const {error}=await requireClient().from(table).delete().eq('id',r.id); if(error){alert(`Account could not be deleted. It may have linked transactions or deletion may be restricted.\n\n${friendlyError(error)}`);return;} toast('Account deleted.'); await navigate(table); }
  });
  $('#add-record').onclick=()=>openAccountForm(table);
  const setup=$('#setup-petty-cash'); if(setup) setup.onclick=async()=>{ if(!confirm('Create a separate Petty Cash account with zero opening balance? Add money later using Transfers & deposits so both accounts are posted correctly.'))return; const {error}=await requireClient().from('cash_accounts').insert({name:'Petty Cash',location:'Petty Cash',opening_balance:0,created_by:session.user.id,active:true}); if(error){alert(`Petty Cash account was not created.\n\n${friendlyError(error)}`);return;} toast('Separate Petty Cash account created. Fund it through Transfers & deposits.'); await navigate('cash_accounts'); };
}
function openAccountForm(table,r=null) {
  const cash=table==='cash_accounts';
  const fields=cash ? [
    {name:'name',label:'Account name',required:true,value:r?.name||''},
    {name:'location',label:'Cash location',value:r?.location||''},
    {name:'opening_balance',label:r?'Opening balance (fixed after setup)':'Opening balance (₹)',type:'number',required:true,min:0,step:'0.01',value:r?.opening_balance??0,readonly:!!r}
  ] : [
    {name:'bank_name',label:'Bank name',required:true,value:r?.bank_name||''},
    {name:'account_label',label:'Account label / nickname',required:true,value:r?.account_label||''},
    {name:'account_holder',label:'Account holder name',required:true,value:r?.account_holder||''},
    {name:'account_number',label:'Account number',required:true,value:r?.account_number||''},
    {name:'ifsc',label:'IFSC code',required:true,value:r?.ifsc||'',pattern:'[A-Za-z]{4}0[A-Za-z0-9]{6}',title:'Enter a valid 11-character IFSC code.'},
    {name:'opening_balance',label:r?'Opening balance (fixed after setup)':'Opening balance (₹)',type:'number',required:true,min:0,step:'0.01',value:r?.opening_balance??0,readonly:!!r}
  ];
  openForm({title:r?(cash?'Edit cash account':'Edit bank account'):(cash?'Add cash account':'Add bank account'),fields,submit:async d=>{
    const payload={...d,opening_balance:Number(d.opening_balance)};
    if(r){
      const result=await requireClient().from(table).update(payload).eq('id',r.id);
      if(result.error)throw result.error;
      toast('Account updated.');
    } else {
      const result=await requireClient().from(table).insert({...payload,created_by:session.user.id,active:true}).select('id').single();
      if(result.error)throw result.error;
      const newId=result.data?.id;
      const ob=Number(d.opening_balance||0);
      if(newId && ob>0){
        try{
          const {error:jerr}=await requireClient().rpc('create_opening_balance_journal',{
            p_account_type: cash?'cash':'bank', p_account_id:newId, p_amount:ob
          });
          if(jerr) console.warn('Opening balance journal:', jerr.message);
          else toast('Account added with balanced opening journal.');
        }catch(e){ console.warn(e); toast('Account added. Opening journal may need manual posting.'); }
      } else toast('Account added.');
    }
    await navigate(table);
  }});
}


/** Show every transaction for a cash/bank account on its own line with running balance. */
function showAccountStatement(table, account, isCash, balance, paymentsData, expensesData, transfersData) {
  const accountId = account.id;
  const accountType = isCash ? 'cash' : 'bank';
  const title = isCash
    ? ('Cash statement — ' + (account.name || 'Account'))
    : ('Bank statement — ' + (account.account_label || account.bank_name || 'Account'));

  const events = [];
  const opening = Number(account.opening_balance || 0);
  events.push({ date: '0000-01-01', sort: '0', ref: '—', type: 'Opening balance', description: 'Opening balance', debit: opening > 0 ? opening : 0, credit: 0 });

  (paymentsData || []).filter(p => isPostedFinancialStatus(p.status) && String(p.account_type||'').toLowerCase() === accountType && p.account_id === accountId)
    .forEach(p => events.push({
      date: p.payment_date, sort: String(p.payment_date||''), ref: p.receipt_no || p.reference || String(p.id||'').slice(0,8),
      type: 'Receipt', description: p.notes || p.receiver_name || 'Client payment',
      debit: Number(p.amount||0), credit: 0
    }));

  (expensesData || []).filter(e => isPostedFinancialStatus(e.status) && String(e.account_type||'').toLowerCase() === accountType && e.account_id === accountId)
    .forEach(e => events.push({
      date: e.expense_date, sort: String(e.expense_date||''), ref: e.reference || String(e.id||'').slice(0,8),
      type: 'Expense', description: ((e.category || 'Expense') + ' — ' + (e.payee || '') + ' ' + (e.description || '')).trim(),
      debit: 0, credit: Number(e.amount||0)
    }));

  (transfersData || []).filter(t => isPostedFinancialStatus(t.status)).forEach(t => {
    if (String(t.destination_type||'').toLowerCase() === accountType && t.destination_id === accountId) {
      events.push({ date: t.transfer_date, sort: String(t.transfer_date||''), ref: t.reference || String(t.id||'').slice(0,8), type: 'Transfer in', description: t.description || 'Funds received', debit: Number(t.amount||0), credit: 0 });
    }
    if (String(t.source_type||'').toLowerCase() === accountType && t.source_id === accountId) {
      events.push({ date: t.transfer_date, sort: String(t.transfer_date||''), ref: t.reference || String(t.id||'').slice(0,8), type: 'Transfer out', description: t.description || 'Funds sent', debit: 0, credit: Number(t.amount||0) });
    }
  });

  events.sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || String(a.ref).localeCompare(String(b.ref)));

  let running = 0;
  const rows = events.map(ev => {
    running += Number(ev.debit||0) - Number(ev.credit||0);
    return '<tr>'
      + '<td>' + (ev.date === '0000-01-01' ? '—' : date(ev.date)) + '</td>'
      + '<td>' + escapeHtml(ev.ref) + '</td>'
      + '<td>' + escapeHtml(ev.type) + '</td>'
      + '<td>' + escapeHtml(ev.description) + '</td>'
      + '<td class="money">' + (ev.debit ? money(ev.debit) : '—') + '</td>'
      + '<td class="money">' + (ev.credit ? money(ev.credit) : '—') + '</td>'
      + '<td class="money"><strong>' + money(running) + '</strong></td>'
      + '</tr>';
  }).join('');

  let dlg = document.querySelector('#account-statement-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'account-statement-dialog';
    dlg.className = 'detail-dialog';
    dlg.style.cssText = 'max-width:min(920px,96vw);width:100%';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = '<div class="dialog-head"><h2>' + escapeHtml(title) + '</h2>'
    + '<button class="icon-btn" type="button" data-close aria-label="Close" title="Close">✕</button></div>'
    + '<div class="detail-content">'
    + '<div class="stat-grid" style="margin-bottom:14px">'
    + '<div class="stat-card"><div class="label">Opening</div><div class="value">' + money(balance.openingBalance) + '</div></div>'
    + '<div class="stat-card"><div class="label">In / Received</div><div class="value">' + money((balance.received||0)+(balance.incoming||0)) + '</div></div>'
    + '<div class="stat-card"><div class="label">Out / Spent</div><div class="value">' + money((balance.spent||0)+(balance.outgoing||0)) + '</div></div>'
    + '<div class="stat-card"><div class="label">Current balance</div><div class="value">' + money(balance.currentBalance) + '</div></div>'
    + '</div>'
    + '<div class="notice">Each payment, expense and transfer is shown on its own line. Running balance updates after every entry.</div>'
    + '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Description</th><th>In (₹)</th><th>Out (₹)</th><th>Balance (₹)</th></tr></thead>'
    + '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;padding:20px">No transactions yet</td></tr>') + '</tbody></table></div>'
    + '</div><div class="dialog-actions"><button class="secondary" type="button" data-close>Close</button></div>';
  dlg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
  dlg.showModal();
}

/* ===================== TRANSFERS ===================== */
async function transfers() {
  const data = await query('transfers');
  $('#page-content').innerHTML = panel('Transfers & cash deposits',
    searchToolbar('Search reference or explanation', `<button class="primary" id="add-record">+ Record transfer</button>`) +
    tableHtml(['Date', 'Source', 'Destination', 'Amount', 'Reference', 'Status'],
      data.map(r => `<tr>
        <td>${date(r.transfer_date)}</td>
        <td>${escapeHtml(r.source_label || r.source_type)}</td>
        <td>${escapeHtml(r.destination_label || r.destination_type)}</td>
        <td>${money(r.amount)}</td>
        <td>${escapeHtml(r.reference || '—')}</td>
        <td>${statusPill(r.status)}</td>
      </tr>`)
    ).replace('<table>', '<table id="records-table">')
  );
  wireSearch();
  $('#add-record').onclick = async () => {
    const [cash, bank] = await Promise.all([
      query('cash_accounts', 'id,name,active', 'name'),
      query('bank_accounts', 'id,account_label,bank_name,active', 'bank_name')
    ]);
    const accounts = [
      ...cash.filter(a => a.active !== false).map(a => ({ value: `cash:${a.id}`, label: `Cash — ${a.name}` })),
      ...bank.filter(a => a.active !== false).map(a => ({ value: `bank:${a.id}`, label: `Bank — ${a.account_label || a.bank_name}` }))
    ];
    openForm({
      title: 'Cash deposit / transfer',
      fields: [
        { name: 'transfer_date', label: 'Date', type: 'date', required: true, value: localDateISO() },
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0.01, step: '0.01' },
        { name: 'source_account', label: 'From account', type: 'select', required: true, options: accounts },
        { name: 'destination_account', label: 'To account', type: 'select', required: true, options: accounts },
        { name: 'reference', label: 'Reference', required: true },
        { name: 'description', label: 'Description / notes', required: true, type: 'textarea', wide: true }
      ],
      submit: async d => {
        const [p_source_type, p_source_id] = String(d.source_account || '').split(':');
        const [p_destination_type, p_destination_id] = String(d.destination_account || '').split(':');
        if (!p_source_type || !p_source_id || !p_destination_type || !p_destination_id) throw new Error('Select valid source and destination accounts.');
        if (p_source_type === p_destination_type && p_source_id === p_destination_id) throw new Error('Source and destination must be different accounts.');
        const { error } = await requireClient().rpc('record_transfer', {
          p_transfer_date: d.transfer_date,
          p_amount: Number(d.amount),
          p_source_type,
          p_source_id,
          p_destination_type,
          p_destination_id,
          p_reference: d.reference.trim(),
          p_description: d.description.trim()
        });
        if (error) {
          console.error('record_transfer RPC failed', error);
          throw new Error(`Transfer was not recorded: ${error.message || 'database function failed'}`);
        }
        toast('Transfer recorded.');
        await navigate('transfers');
      }
    });
  };
}

/* ===================== LEDGERS ===================== */
async function ledger(kind) {
  const isClient = kind === 'client';
  const title = isClient ? 'CLIENT LEDGERS' : 'SUB-AGENT LEDGERS';
  const table = isClient ? 'clients' : 'sub_agents';
  const data = await query(table, '*', 'created_at');
  const rows = data.map(r => {
    const name = isClient ? (r.full_name || [r.first_name || r.name || '', r.surname || ''].filter(Boolean).join(' ') || r.display_name || r.company_name || '') : (r.full_name || [r.first_name || r.name || r.company_name || '', r.surname || ''].filter(Boolean).join(' ') || r.display_name || '');
    const id = String(r.id || '');
    return `<tr><td>${escapeHtml(name || r.display_name || '—')}</td><td>${escapeHtml(r.email || '—')}</td><td>${escapeHtml(r.mobile || r.mobile_no || r.phone || '—')}</td><td><button class="secondary small-btn" data-ledger-view="${escapeHtml(id)}">VIEW LEDGER</button></td></tr>`;
  });
  $('#page-content').innerHTML = panel(title, `<div class="notice">Select a ${isClient ? 'client' : 'sub-agent'} to inspect their profile and related accounting records. Ledger balances must be based on posted journal entries.</div>${searchToolbar(`Search ${isClient ? 'clients' : 'sub-agents'}`)}${tableHtml(['Name','Email','Mobile','Action'], rows).replace('<table>','<table id="records-table">')}`);
  wireSearch();
  $('#page-content').querySelectorAll('[data-ledger-view]').forEach(btn => btn.onclick = async () => {
    const record = data.find(r => String(r.id) === btn.dataset.ledgerView);
    if (!record) return;
    const name = [record.first_name || record.name || record.company_name || '', record.surname || ''].filter(Boolean).join(' ');
    $('#detail-title').textContent = `${isClient ? 'CLIENT' : 'SUB-AGENT'}: ${name || 'Details'}`;
    $('#detail-content').innerHTML = `<div class="detail-grid">${Object.entries(record).filter(([k,v]) => v !== null && v !== '' && !['id','created_at','updated_at'].includes(k)).map(([k,v]) => `<div class="detail-item"><small>${escapeHtml(k.replaceAll('_',' ').toUpperCase())}</small><strong>${escapeHtml(String(v))}</strong></div>`).join('')}</div><p class="muted">This view shows the saved profile. The full person-specific journal allocation depends on client/sub-agent links in the database schema.</p>`;
    $('#detail-dialog').showModal();
  });
}

async function generalLedger() {
  const [entries, lines, accounts] = await Promise.all([
    queryAll('journal_entries', '*', 'entry_date'),
    queryAll('journal_lines', '*', 'journal_entry_id'),
    queryAll('chart_of_accounts', 'id,account_name,account_type', 'account_name')
  ]);
  const entryById = new Map(entries.map(e => [String(e.id), e]));
  const accountById = new Map(accounts.map(a => [String(a.id), a]));
  const activeLines = lines.filter(l => { const e = entryById.get(String(l.journal_entry_id || l.entry_id)); return e && isPostedFinancialStatus(e.status); });
  const groups = new Map();
  for (const line of activeLines) {
    const e = entryById.get(String(line.journal_entry_id || line.entry_id));
    const key = String(e.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({line,entry:e,account:accountById.get(String(line.account_id))});
  }
  const rows = [...groups.values()].flatMap(group => group.map((x,i) => {
    const other = group.filter(y => y !== x).map(y => y.account?.account_name).filter(Boolean).join(' / ');
    const debit = Number(x.line.debit || 0), credit = Number(x.line.credit || 0);
    const explanation = debit > 0 ? `${x.account?.account_name || 'Account'} Dr. to ${other || 'counter-account'}` : `${other || 'Counter-account'} Dr. to ${x.account?.account_name || 'Account'}`;
    return `<tr><td>${date(x.entry.entry_date)}</td><td>${escapeHtml(x.entry.reference || x.entry.id?.slice(0,8) || '—')}</td><td>${escapeHtml(x.entry.description || '—')}</td><td>${escapeHtml(explanation)}</td><td>${escapeHtml(x.account?.account_name || 'Unmapped account')}</td><td class="amount">${debit ? money(debit) : '—'}</td><td class="amount">${credit ? money(credit) : '—'}</td><td>${statusPill(x.entry.status)}</td></tr>`;
  }));
  $('#page-content').innerHTML = panel('GENERAL LEDGER', `<div class="notice">Double-entry rules: debit the receiver and credit the giver; debit what comes in and credit what goes out; debit expenses and losses, credit incomes and gains. Each row is a posted journal line with its counter-account. Confirm account mapping and balanced journal totals before relying on reports.</div>${searchToolbar('Search date, reference, account or description', '<button class="secondary" id="ledger-print">PRINT / SAVE AS PDF</button>')}${tableHtml(['Date','Reference','Description','Posting explanation','Account','Debit','Credit','Status'], rows).replace('<table>','<table id="records-table">')}`);
  wireSearch();
  $('#ledger-print').onclick = () => window.print();
}

/* ===================== REPORTS ===================== */
function periodDates(period, customFrom = '', customTo = '') {
  const today = localDateISO();
  const [todayYear,todayMonth,todayDay] = today.split('-').map(Number);
  const d = new Date(Date.UTC(todayYear,todayMonth-1,todayDay,12));
  const fmt = dt => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
  if (period === 'today') return { from: today, to: today };
  if (period === 'last_month') {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()-1, 1, 12));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
    return { from: fmt(first), to: fmt(last) };
  }
  if (period === 'financial_year') {
    const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear()-1;
    return { from: `${y}-04-01`, to: today };
  }
  if (period === 'custom') return { from: customFrom, to: customTo };
  return { from: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`, to: today };
}

async function reports() {
  $('#page-content').innerHTML = panel('Financial reports', `
    <div class="notice">Administrator-only reporting. Cash-Based Operating Result is a management metric, not statutory/accrual profit. All downloads are generated from existing records; unavailable figures are explicitly marked.</div>
    <div class="toolbar" style="flex-wrap:wrap;gap:10px;align-items:end">
      <label>Period<select id="rpt-period"><option value="today">Today</option><option value="this_month" selected>This month</option><option value="last_month">Last month</option><option value="financial_year">This financial year (Apr–Mar)</option><option value="custom">Custom date range</option></select></label>
      <label>From<input type="date" id="rpt-from" value="${periodDates('this_month').from}"></label>
      <label>To<input type="date" id="rpt-to" value="${periodDates('this_month').to}"></label>
      <button class="primary" id="rpt-run">Generate report</button>
    </div>
    <div class="toolbar" style="flex-wrap:wrap;gap:10px;margin-top:12px">
      <button class="secondary" id="rpt-trial">SAVE TRIAL BALANCE AS PDF</button>
      <button class="secondary" id="rpt-pl">SAVE PROFIT &amp; LOSS AS PDF</button>
      <button class="secondary" id="rpt-bs">SAVE BALANCE SHEET AS PDF</button>
      <button class="secondary" id="rpt-ledger">SAVE GENERAL LEDGER AS PDF</button>
      <button class="secondary" id="rpt-outstanding">SAVE OUTSTANDING RECEIVABLES AS PDF</button>
      <button class="secondary" id="rpt-invoices">SAVE INVOICE REGISTER AS PDF</button>
    </div>
    <div id="report-output" style="margin-top:16px"></div>
  `);
  const period = $('#rpt-period'), fromEl = $('#rpt-from'), toEl = $('#rpt-to');
  const syncDates = () => { const r=periodDates(period.value,fromEl.value,toEl.value); if(period.value!=='custom'){fromEl.value=r.from;toEl.value=r.to;} fromEl.disabled=toEl.disabled=period.value!=='custom'; };
  period.onchange=syncDates; syncDates();
  const range = () => { const r={from:fromEl.value,to:toEl.value}; if(!r.from||!r.to||r.from>r.to) throw new Error('Choose a valid reporting date range.'); return r; };
  const loadJournalData = async () => {
    const [accountsData, entriesData, linesData] = await Promise.all([
      queryAll('chart_of_accounts','id,account_name,account_type,is_active','account_name'),
      queryAll('journal_entries','id,entry_date,description,reference,status','entry_date'),
      queryAll('journal_lines','id,journal_entry_id,account_id,debit,credit','journal_entry_id')
    ]);
    const entries = new Map(entriesData.filter(j=>isPostedFinancialStatus(j.status)).map(j=>[j.id,j]));
    const accountsById = new Map(accountsData.map(a=>[a.id,a]));
    return { accountsData, entriesData, linesData, entries, accountsById };
  };
  const journalLinesInRange = (loaded, from, to, endOnly=false) => loaded.linesData.flatMap(line=>{
    const entry=loaded.entries.get(line.journal_entry_id);
    if(!entry || !entry.entry_date) return [];
    const entryDate=String(entry.entry_date).slice(0,10);
    if(endOnly ? entryDate>to : !inDateRange(entryDate,from,to)) return [];
    const account=loaded.accountsById.get(line.account_id);
    if(!account) return [];
    return [{...line,entry,account}];
  });
  $('#rpt-run').onclick=async()=>{
    const out=$('#report-output'); out.innerHTML='<div class="loading">Calculating report…</div>';
    try {
      const r=range();
      const [paymentsData, expensesData, invoicesData, trialResult] = await Promise.all([
        queryAll('payments','id,invoice_id,payment_date,amount,status','payment_date'),
        queryAll('expenses','id,expense_date,amount,status,category,payee,description,account_type,account_id','expense_date'),
        queryAll('invoices','id,invoice_no,invoice_date,client_name_snapshot,total,status','invoice_date'),
        requireClient().rpc('get_trial_balance')
      ]);
      if(trialResult.error) throw trialResult.error;
      const allPayments=paymentsData.filter(p=>isPostedFinancialStatus(p.status));
      const allExpenses=expensesData.filter(e=>isPostedFinancialStatus(e.status));
      const calc=cashBasedPreliminary({payments:allPayments,expenses:allExpenses,from:r.from,to:r.to});
      const tb=trialResult.data||[];
      const cashBank=tb.filter(a=>/cash|bank/i.test(String(a.account_name||'')) && !/receivable|payable/i.test(String(a.account_name||''))).reduce((s,a)=>s+Number(a.debit||0)-Number(a.credit||0),0);
      const receivedByInvoice=new Map();
      for(const p of allPayments){if(p.invoice_id)receivedByInvoice.set(p.invoice_id,(receivedByInvoice.get(p.invoice_id)||0)+Number(p.amount||0));}
      const receivableRows=invoicesData.filter(i=>!/(void|cancel|revers|draft)/i.test(String(i.status||''))).map(i=>({invoice:i,received:receivedByInvoice.get(i.id)||0,balance:Math.max(0,Number(i.total||0)-(receivedByInvoice.get(i.id)||0))})).filter(x=>x.balance>0.005);
      const cashRows=tb.filter(a=>/cash|bank/i.test(String(a.account_name||'')) && !/receivable|payable/i.test(String(a.account_name||''))).map(a=>`<tr><td>${escapeHtml(a.account_name)}</td><td>${money(Number(a.debit||0)-Number(a.credit||0))}</td></tr>`);
      const payRows=receivableRows.map(x=>`<tr><td>${escapeHtml(x.invoice.invoice_no||'—')}</td><td>${date(x.invoice.invoice_date)}</td><td>${escapeHtml(x.invoice.client_name_snapshot||'—')}</td><td>${money(x.invoice.total)}</td><td>${money(x.received)}</td><td>${money(x.balance)}</td></tr>`);
      const paidExpenseRows=allExpenses.filter(e=>inDateRange(e.expense_date,r.from,r.to)).map(e=>`<tr><td>${date(e.expense_date)}</td><td>${escapeHtml(e.category||'—')}</td><td>${escapeHtml(e.payee||'—')}</td><td>${escapeHtml(e.description||'—')}</td><td>${money(e.amount)}</td></tr>`);
      out.innerHTML = panel(`Cash-based report · ${date(r.from)} – ${date(r.to)}`, `
        <div class="stats-grid">
          <article class="stat-card"><span>Client payments received (C)</span><strong>${money(calc.C)}</strong><small>${calc.paymentCount} posted receipt(s)</small></article>
          <article class="stat-card"><span>Operating expenses paid (E)</span><strong>${money(calc.E)}</strong><small>${calc.paidExpenseCount} posted expense(s)</small></article>
          <article class="stat-card"><span>Current cash &amp; bank balance</span><strong>${money(cashBank)}</strong><small>Current position from cash and bank accounts</small></article>
          <article class="stat-card"><span>Outstanding receivables</span><strong>${money(receivableRows.reduce((s,x)=>s+x.balance,0))}</strong><small>Shown separately; excluded from cash received</small></article>
        </div>
        <div class="notice" style="margin-top:14px"><strong>Cash-Based Operating Result: not yet certifiable.</strong><br>Current documented schema does not confirm a structured register for expenses incurred but unpaid (U) or future expense commitments. The available subtotal C − E is <strong>${money(calc.beforeUnpaidIncurredExpenses)}</strong>, before subtracting U. It is not being mislabeled as the final operating result. Outstanding payables and projected cash after future commitments are also unavailable until those records are tracked explicitly.</div>
        ${panel('Cash & bank balances',tableHtml(['Account','Net debit balance'],cashRows))}
        ${panel('Paid operating expenses during period',tableHtml(['Date','Category','Payee','Description','Amount'],paidExpenseRows))}
        ${panel('Outstanding receivables (separate from P&L)',tableHtml(['Invoice','Date','Client','Invoice amount','Received','Outstanding'],payRows))}
        <div class="toolbar"><button class="secondary" id="rpt-download-cash">PRINT / SAVE THIS REPORT AS PDF</button></div>
      `);
      $('#rpt-download-cash').onclick=()=>printReport('CASH MANAGEMENT REPORT',`cash-management-${r.from}-to-${r.to}.pdf`,['Metric','Amount','Status'],[
        ['Client payments received (C)',calc.C,'Calculated from posted payment records'],['Paid operating expenses (E)',calc.E,'Calculated from posted expense records'],['C - E before unpaid incurred expenses',calc.beforeUnpaidIncurredExpenses,'Preliminary only; not final operating result'],['Total cash and bank',cashBank,'Trial balance accounts 1000 and 1010'],['Outstanding receivables',receivableRows.reduce((s,x)=>s+x.balance,0),'Separate from cash P&L'],['Unpaid incurred expenses (U)','','Not available: no confirmed structured schema'],['Future commitments','','Not available: no confirmed structured schema']]);
    } catch(e) { console.error('Cash-based report failed',e); out.innerHTML=`<div class="notice">Report could not be generated: ${escapeHtml(e.message||'Database query failed')}. No figures have been guessed.</div>`; }
  };
  $('#rpt-trial').onclick=async()=>{try{const r=range();const loaded=await loadJournalData();const lines=journalLinesInRange(loaded,'1900-01-01',r.to,true);const sums=new Map();for(const x of lines){const key=x.account.id;const prior=sums.get(key)||{a:x.account,debit:0,credit:0};prior.debit+=Number(x.debit||0);prior.credit+=Number(x.credit||0);sums.set(key,prior);}const rows=[...sums.values()].sort((a,b)=>String(a.a.account_name).localeCompare(String(b.a.account_name))).map(x=>[x.a.account_name,x.a.account_type,+x.debit.toFixed(2),+x.credit.toFixed(2),+(x.debit-x.credit).toFixed(2)]);printReport('TRIAL BALANCE',`trial-balance-as-of-${r.to}.pdf`,['Account','Type','Debits through date','Credits through date','Net balance'],rows,'',r.to);toast('Trial balance opened. Choose Save as PDF in the print dialog.');}catch(e){toast(`Trial balance download failed: ${friendlyError(e)}`);}};
  $('#rpt-pl').onclick=async()=>{try{const r=range();const loaded=await loadJournalData();const lines=journalLinesInRange(loaded,r.from,r.to);const sums=new Map();for(const x of lines){const type=String(x.account.account_type||'').toLowerCase();if(!['income','expense'].includes(type))continue;const v=type==='income'?Number(x.credit||0)-Number(x.debit||0):Number(x.debit||0)-Number(x.credit||0);const key=x.account.id;const prior=sums.get(key)||{a:x.account,amount:0};prior.amount+=v;sums.set(key,prior);}const rows=[...sums.values()].sort((a,b)=>String(a.a.account_name).localeCompare(String(b.a.account_name))).map(x=>[x.a.account_name,x.a.account_type,+x.amount.toFixed(2)]);printReport('PROFIT & LOSS',`formal-profit-loss-${r.from}-to-${r.to}.pdf`,['Account','Type','Period amount'],rows,r.from,r.to);toast('P&L opened for PDF printing. Verify account classifications and tax treatment with your accountant.');}catch(e){toast(`Formal P&L download failed: ${friendlyError(e)}`);}};
  $('#rpt-bs').onclick=async()=>{try{const r=range();const loaded=await loadJournalData();const lines=journalLinesInRange(loaded,'1900-01-01',r.to,true);const sums=new Map();let currentEarnings=0;for(const x of lines){const type=String(x.account.account_type||'').toLowerCase();const debit=Number(x.debit||0),credit=Number(x.credit||0);if(type==='income')currentEarnings+=credit-debit;else if(type==='expense')currentEarnings+=debit-credit;else if(['asset','liability','equity'].includes(type)){const key=x.account.id;const prior=sums.get(key)||{a:x.account,balance:0};prior.balance+=type==='asset'?debit-credit:credit-debit;sums.set(key,prior);}}const rows=[...sums.values()].sort((a,b)=>String(a.a.account_name).localeCompare(String(b.a.account_name))).map(x=>[x.a.account_name,x.a.account_type,+x.balance.toFixed(2)]);if(Math.abs(currentEarnings)>0.005)rows.push(['—','Current / unclosed earnings (derived)','EQUITY',+currentEarnings.toFixed(2)]);printReport('BALANCE SHEET',`balance-sheet-as-of-${r.to}.pdf`,['Account','Type','Net balance'],rows,'',r.to);toast('Balance sheet opened for PDF printing. Includes derived unclosed earnings; reconcile against the live trial balance before statutory use.');}catch(e){toast(`Balance sheet download failed: ${friendlyError(e)}`);}};
  $('#rpt-ledger').onclick=async()=>{try{const r=range();const loaded=await loadJournalData();const lines=journalLinesInRange(loaded,r.from,r.to);const byEntry=new Map();lines.forEach(x=>{if(!byEntry.has(x.journal_entry_id))byEntry.set(x.journal_entry_id,[]);byEntry.get(x.journal_entry_id).push(x);});const rows=lines.map(x=>{const counterparts=(byEntry.get(x.journal_entry_id)||[]).filter(y=>y.id!==x.id).map(y=>y.account.account_name).filter(Boolean).join(' / ');const explanation=Number(x.debit||0)>0?`${x.account.account_name} Dr to ${counterparts||'counter-account'}`:`${counterparts||'counter-account'} Dr to ${x.account.account_name}`;return [x.entry.entry_date,x.entry.reference||x.journal_entry_id,x.entry.description,explanation,x.account.account_name,x.debit,x.credit];});printReport('GENERAL LEDGER',`general-ledger-${r.from}-to-${r.to}.pdf`,['Date','Journal reference','Description','Posting explanation','Account','Debit','Credit'],rows,r.from,r.to);toast('General ledger opened for PDF printing. Each journal line is shown with its counterpart account.');}catch(e){toast(`General ledger download failed: ${friendlyError(e)}`);}};
  $('#rpt-outstanding').onclick=async()=>{try{const [invoices,payments]=await Promise.all([query('invoices','id,invoice_no,invoice_date,client_name_snapshot,total,status','invoice_date'),query('payments','invoice_id,amount,status','payment_date')]);const paid=new Map();payments.filter(p=>isPostedFinancialStatus(p.status)).forEach(p=>{if(p.invoice_id)paid.set(p.invoice_id,(paid.get(p.invoice_id)||0)+Number(p.amount||0));});printReport('OUTSTANDING RECEIVABLES','outstanding-receivables.pdf',['Invoice','Date','Client','Invoice amount','Received','Balance'],invoices.filter(i=>!/(void|cancel|revers|draft)/i.test(String(i.status||''))).map(i=>[i.invoice_no,i.invoice_date,i.client_name_snapshot,i.total,paid.get(i.id)||0,Math.max(0,Number(i.total||0)-(paid.get(i.id)||0))]).filter(r=>r[5]>0.005));toast('Outstanding receivables report opened for PDF printing.');}catch(e){toast(`Outstanding report failed: ${friendlyError(e)}`);}};
  $('#rpt-invoices').onclick=async()=>{try{const r=range();const [invoices,paymentsData]=await Promise.all([queryAll('invoices','id,invoice_no,invoice_date,client_name_snapshot,total,status','invoice_date'),queryAll('payments','invoice_id,amount,status','payment_date')]);const paid=new Map();paymentsData.filter(p=>isPostedFinancialStatus(p.status)).forEach(p=>{if(p.invoice_id)paid.set(p.invoice_id,(paid.get(p.invoice_id)||0)+Number(p.amount||0));});printReport('INVOICE REGISTER',`invoice-register-${r.from}-to-${r.to}.pdf`,['Invoice','Date','Client','Status','Total','Received','Balance'],invoices.filter(x=>inDateRange(x.invoice_date,r.from,r.to)).map(x=>[x.invoice_no,x.invoice_date,x.client_name_snapshot,x.status,x.total,paid.get(x.id)||0,Math.max(0,Number(x.total||0)-(paid.get(x.id)||0))]),r.from,r.to);toast('Invoice register report opened for PDF printing.');}catch(e){toast(`Invoice export failed: ${friendlyError(e)}`);}};
}

/* ===================== PETTY CASH ===================== */
async function pettyCash() {
  const [accountsData, expensesData, transfersData] = await Promise.all([
    queryAll('cash_accounts','id,name,location,opening_balance,active','name'),
    queryAll('expenses','id,expense_date,amount,status,category,payee,description,account_type,account_id,reference','expense_date'),
    queryAll('transfers','id,transfer_date,amount,status,source_type,source_id,destination_type,destination_id,reference,description','transfer_date')
  ]);
  const fund=accountsData.find(a=>String(a.name||'').trim().toLowerCase()==='petty cash');
  if(!fund){$('#page-content').innerHTML=panel('Petty Cash',`<div class="notice">A separate cash account named <strong>Petty Cash</strong> has not been set up yet. Create it from Cash accounts first; use transfers to fund it.</div><button class="primary" id="goto-cash">Open Cash accounts</button>`);$('#goto-cash').onclick=()=>navigate('cash_accounts');return;}
  const validExpenses=expensesData.filter(e=>isPostedFinancialStatus(e.status));
  const validTransfers=transfersData.filter(t=>isPostedFinancialStatus(t.status));
  const calc=computePettyCashBalance({openingBalance:fund.opening_balance,expenses:validExpenses,transfers:validTransfers,accountId:fund.id});
  const events=[];
  validTransfers.forEach(t=>{
    if(String(t.destination_type||'').toLowerCase()==='cash'&&t.destination_id===fund.id)events.push({date:t.transfer_date,ref:t.reference||t.id?.slice(0,8),type:'Funds received',description:t.description||'Transfer into petty cash',received:Number(t.amount||0),paid:0});
    if(String(t.source_type||'').toLowerCase()==='cash'&&t.source_id===fund.id)events.push({date:t.transfer_date,ref:t.reference||t.id?.slice(0,8),type:'Transfer out',description:t.description||'Transfer from petty cash',received:0,paid:Number(t.amount||0)});
  });
  validExpenses.filter(e=>String(e.account_type||'').toLowerCase()==='cash'&&e.account_id===fund.id).forEach(e=>events.push({date:e.expense_date,ref:e.reference||e.id?.slice(0,8),type:'Expense',description:`${e.category||'Expense'} — ${e.payee||''} ${e.description||''}`.trim(),received:0,paid:Number(e.amount||0)}));
  events.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.ref).localeCompare(String(b.ref)));
  let running=Number(fund.opening_balance||0);
  const rows=events.map(e=>{running+=e.received-e.paid;return `<tr><td>${date(e.date)}</td><td>${escapeHtml(e.ref||'—')}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.description)}</td><td>${e.received?money(e.received):'—'}</td><td>${e.paid?money(e.paid):'—'}</td><td>${money(running)}</td></tr>`;});
  $('#page-content').innerHTML=panel('Petty Cash',`
    <div class="notice">This ledger uses the existing posted expense and transfer records. Funding and transfers are internal movements, not revenue. New fund-limit, custodian, and physical-count fields are not confirmed in the current schema, so they are not fabricated here.</div>
    <div class="stats-grid">
      <article class="stat-card"><span>Current calculated balance</span><strong>${money(calc.closingBalance)}</strong><small>${escapeHtml(fund.name)}</small></article>
      <article class="stat-card"><span>Opening balance</span><strong>${money(calc.openingBalance)}</strong></article>
      <article class="stat-card"><span>Funds received</span><strong>${money(calc.incoming)}</strong><small>Internal transfers in</small></article>
      <article class="stat-card"><span>Expenses paid</span><strong>${money(calc.paidExpenses)}</strong></article>
      <article class="stat-card"><span>Transfers out</span><strong>${money(calc.outgoing)}</strong></article>
    </div>
    <div class="toolbar" style="margin-top:14px"><button class="primary" id="petty-expense">Record petty cash expense</button><button class="secondary" id="petty-transfer">Add funds / transfer</button><button class="secondary" id="petty-export">Download ledger CSV</button></div>
    ${panel('Chronological petty cash ledger',tableHtml(['Date','Voucher / reference','Type','Description','Funds received','Paid / transferred out','Running balance'],rows))}
    <p class="small muted">Reconcile the physical cash separately before treating this balance as confirmed. A posted transaction's accounting impact remains governed by the existing secure RPC functions.</p>
  `);
  $('#petty-expense').onclick=()=>navigate('expenses');
  $('#petty-transfer').onclick=()=>navigate('transfers');
  $('#petty-export').onclick=()=>exportCsv('petty-cash-ledger.csv',['Date','Voucher / reference','Type','Description','Funds received','Paid / transferred out','Running balance'],events.reduce((acc,e)=>{const prev=acc.length?Number(acc[acc.length-1][6]):Number(fund.opening_balance||0);const next=prev+e.received-e.paid;acc.push([e.date,e.ref,e.type,e.description,e.received||0,e.paid||0,next.toFixed(2)]);return acc;},[]));
}

/* ===================== RECEIVABLES ===================== */
async function receivables() {
  const [invoices, payments] = await Promise.all([
    query('invoices', 'id,invoice_no,invoice_date,client_name_snapshot,total,status', 'invoice_date'),
    query('payments', 'invoice_id,amount,status', 'payment_date')
  ]);
  const receivedByInvoice = new Map();
  for (const payment of payments) {
    if (!payment.invoice_id || !isPostedFinancialStatus(payment.status)) continue;
    receivedByInvoice.set(payment.invoice_id, (receivedByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount || 0));
  }
  const activeInvoices = invoices.filter(i => !/(void|cancel|revers|draft)/i.test(String(i.status || '')));
  const rows = activeInvoices.flatMap(i => {
    const total = Number(i.total || 0);
    const received = receivedByInvoice.get(i.id) || 0;
    const balance = Math.max(0, total - received);
    if (balance <= 0.005) return [];
    return [`<tr>
      <td>${escapeHtml(i.invoice_no)}</td><td>${date(i.invoice_date)}</td>
      <td>${escapeHtml(i.client_name_snapshot || '—')}</td><td>${money(total)}</td>
      <td>${money(received)}</td><td><strong>${money(balance)}</strong></td>
      <td>${escapeHtml(received > 0 ? 'Partially paid' : (i.status || 'Unpaid'))}</td><td><button class="secondary small-btn" data-outstanding-view="${escapeHtml(i.id)}">VIEW</button></td>
    </tr>`];
  });
  $('#page-content').innerHTML = panel('Outstanding client balances', `
    <div class="notice">Balances are calculated from invoice totals less recorded payments. Verify against the general ledger before financial reporting.</div>
    <div class="toolbar"><input id="receivables-search" placeholder="Search bill or client" aria-label="Search"></div>
    ${tableHtml(['Bill', 'Date', 'Client', 'Total', 'Received', 'Balance', 'Status', 'Details'], rows).replace('<table>', '<table id="records-table">')}
  `);
  const inp = $('#receivables-search');
  if (inp) inp.oninput = () => {
    const q = inp.value.toLowerCase();
    $('#records-table tbody')?.querySelectorAll('tr').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(q));
  };
  $('#page-content').querySelectorAll('[data-outstanding-view]').forEach(btn => btn.onclick = () => showInvoiceDetails(btn.dataset.outstandingView));
}

/* ===================== AUDIT / DOWNLOADS / VOIDED ===================== */
async function audit() {
  let data=[];
  try { data=await query('login_history','id,user_id,user_email,event_type,outcome,created_at','created_at'); }
  catch (e) {
    $('#page-content').innerHTML=panel('LOGIN HISTORY',`<div class="notice">Login history table is not available. Apply the authoritative <strong>Supabase SQL.sql</strong> file, then refresh.</div>`);
    return;
  }
  let nameMap = new Map();
  try {
    const ids = [...new Set(data.map(x => x.user_id).filter(Boolean))];
    if (ids.length) {
      const { data: people } = await requireClient().from('profile_directory').select('id,display_name,email').in('id', ids);
      nameMap = new Map((people || []).map(x => [String(x.id), x.display_name || x.email || '—']));
    }
  } catch {}
  $('#page-content').innerHTML = panel('LOGIN HISTORY',
    `<div class="notice">Real authentication events (sign-in / sign-out). Timestamps are stored in UTC and shown as recorded.</div>` +
    searchToolbar('Search user, event or outcome') +
    tableHtml(['When (UTC)','User name','Email','Event','Outcome'], data.map(r => {
      const name = nameMap.get(String(r.user_id)) || '—';
      const when = r.created_at ? dateTimeIST(r.created_at) : '—';
      return `<tr><td>${escapeHtml(when)}</td><td>${escapeHtml(name)}</td><td>${escapeHtml(r.user_email||'—')}</td><td>${escapeHtml(r.event_type||'sign_in')}</td><td>${statusPill(r.outcome||'success')}</td></tr>`;
    })).replace('<table>','<table id="records-table">')
  );
  wireSearch();
}

async function downloads() {
  const data = await query('download_logs', '*', 'created_at').catch(() => []);
  let userNames=new Map();
  try { const ids=[...new Set(data.map(x=>x.user_id).filter(Boolean))]; if(ids.length){const {data:people}=await requireClient().from('profile_directory').select('id,display_name').in('id',ids);userNames=new Map((people||[]).map(x=>[String(x.id),x.display_name]));} } catch {}
  $('#page-content').innerHTML = panel('DOWNLOADED HISTORY',
    tableHtml(['When', 'User', 'Document', 'Format', 'Status', 'Details'],
      (data || []).map(r => `<tr>
        <td>${escapeHtml(r.created_at?.slice(0, 19)?.replace('T', ' ') || '—')}</td>
        <td>${escapeHtml(userNames.get(String(r.user_id)) || r.user_id || '—')}</td>
        <td>${escapeHtml(r.document_type || '—')}</td>
        <td>${escapeHtml(r.file_format || '—')}</td>
        <td>${escapeHtml(r.status || '—')}</td>
        <td><button class="secondary small-btn" data-download-view="${escapeHtml(r.id || '')}">VIEW</button></td>
      </tr>`)
    )
  );
  $('#page-content').querySelectorAll('[data-download-view]').forEach(btn => btn.onclick = () => { const r=data.find(x=>String(x.id||'')===btn.dataset.downloadView); if(!r)return; $('#detail-title').textContent='DOWNLOAD EVENT DETAILS'; $('#detail-content').innerHTML=`<div class="detail-grid">${Object.entries(r).map(([k,v])=>`<div class="detail-item"><small>${escapeHtml(k.replaceAll('_',' ').toUpperCase())}</small><strong>${escapeHtml(String(v ?? '—'))}</strong></div>`).join('')}</div>`; $('#detail-dialog').showModal(); });
}

async function voided() {
  let data=[];
  try { data=await query('deleted_records','id,table_name,record_id,record_snapshot,deleted_by,deleted_at','deleted_at'); }
  catch (e) { $('#page-content').innerHTML=panel('DELETED / VOIDED RECORDS',`<div class="notice">Apply <strong>AVENIX_UI_AUDIT_RECONCILIATION_UPGRADE.sql</strong> to preserve deleted-record snapshots. Hard-deleted records from before the upgrade cannot be recovered from this log.</div>`); return; }
  $('#page-content').innerHTML=panel('DELETED / VOIDED RECORDS',
    `<div class="notice">Deletion snapshots are retained for audit review. Prefer voiding or reversing posted financial entries instead of deleting them.</div>` + searchToolbar('Search table or record reference') +
    tableHtml(['Deleted at','Record type','Record reference','Deleted by','Snapshot'],data.map(r=>`<tr><td>${escapeHtml(r.deleted_at?.slice(0,19)?.replace('T',' ')||'—')}</td><td>${escapeHtml(r.table_name||'—')}</td><td>${escapeHtml(r.record_id||'—')}</td><td>${escapeHtml(r.deleted_by||'—')}</td><td><button type="button" class="icon-btn" data-deleted-view="${escapeHtml(r.id)}" title="View snapshot" aria-label="View snapshot">◉</button></td></tr>`)).replace('<table>','<table id="records-table">')
  );
  wireSearch();
  $('#page-content').querySelectorAll('[data-deleted-view]').forEach(btn=>btn.onclick=()=>{const r=data.find(x=>String(x.id)===btn.dataset.deletedView);if(!r)return;$('#detail-title').textContent=`DELETED ${String(r.table_name||'RECORD').toUpperCase()} SNAPSHOT`;$('#detail-content').innerHTML=`<pre class="audit-snapshot">${escapeHtml(JSON.stringify(r.record_snapshot||{},null,2))}</pre>`;$('#detail-dialog').showModal();});
}

/* ===================== PERIODS / RECONCILIATION / EXCEPTIONS ===================== */
async function periods() {
  $('#page-content').innerHTML = panel('Accounting period closing', `
    <div class="notice">Period closing is not available yet.</div>
    <p>To enable this safely, add an accounting_periods table and a SECURITY DEFINER close-period function with validation against posted journal entries. Do not use this screen to assume a period is locked.</p>
  `);
}

async function reconciliation() {
  let accounts=[], sessions=[];
  try {
    [accounts,sessions]=await Promise.all([
      query('bank_accounts','id,bank_name,account_label,account_number,active','bank_name'),
      query('bank_reconciliations','id,bank_account_id,statement_start,statement_end,statement_closing_balance,ledger_closing_balance,status,notes,created_at','created_at')
    ]);
  } catch(e) {
    $('#page-content').innerHTML=panel('BANK RECONCILIATION',`<div class="notice">Apply <strong>AVENIX_UI_AUDIT_RECONCILIATION_UPGRADE.sql</strong> in Supabase to enable reconciliation sessions and statement lines.</div><p>Bank statement lines are stored separately from posted ledger transactions. Reconciliation does not create income or expenses by itself.</p>`);
    return;
  }
  const accountMap=new Map(accounts.map(a=>[String(a.id),a]));
  const rows=sessions.map(r=>{const a=accountMap.get(String(r.bank_account_id));const difference=Number(r.statement_closing_balance||0)-Number(r.ledger_closing_balance||0);return `<tr><td>${escapeHtml(a?.account_label||a?.bank_name||'Bank account')}</td><td>${date(r.statement_start)} – ${date(r.statement_end)}</td><td class="amount">${money(r.statement_closing_balance)}</td><td class="amount">${r.ledger_closing_balance==null?'Not calculated':money(r.ledger_closing_balance)}</td><td>${r.ledger_closing_balance==null?'—':`<strong class="${Math.abs(difference)<0.005?'text-success':'text-danger'}">${money(difference)}</strong>`}</td><td>${statusPill(r.status)}</td><td><button class="icon-btn" data-recon-view="${escapeHtml(r.id)}" title="View reconciliation" aria-label="View reconciliation">◉</button></td></tr>`;});
  $('#page-content').innerHTML=panel('BANK RECONCILIATION',`
    <div class="notice">Compare the closing balance on the bank statement with the book balance. Importing or matching statement lines must never post duplicate receipts, expenses, or transfers.</div>
    <div class="stats-grid"><article class="stat-card"><span>Reconciliation sessions</span><strong>${sessions.length}</strong><small>Saved statement periods</small></article><article class="stat-card"><span>In progress</span><strong>${sessions.filter(x=>['draft','in_progress'].includes(x.status)).length}</strong><small>Awaiting review</small></article><article class="stat-card"><span>Reconciled</span><strong>${sessions.filter(x=>x.status==='reconciled').length}</strong><small>Completed periods</small></article></div>
    <section class="reconciliation-create"><h3>Start a reconciliation</h3><form id="reconciliation-form" class="form-grid"><label class="field">BANK ACCOUNT<select id="recon-account" required>${accounts.filter(a=>a.active!==false).map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml([a.bank_name,a.account_label,a.account_number?'••••'+String(a.account_number).slice(-4):''].filter(Boolean).join(' · '))}</option>`).join('')}</select></label><label class="field">STATEMENT START<input id="recon-start" type="date" required></label><label class="field">STATEMENT END<input id="recon-end" type="date" required></label><label class="field">STATEMENT CLOSING BALANCE (₹)<input id="recon-closing" type="number" min="0" step="0.01" required></label><label class="field wide">NOTES<textarea id="recon-notes" rows="2" placeholder="Statement reference or reconciliation notes"></textarea></label><div class="field wide"><button class="primary" type="submit">Create reconciliation</button></div></form></section>
    <h3>Saved reconciliations</h3>${tableHtml(['Bank account','Statement period','Statement closing','Book balance','Difference','Status','View'],rows).replace('<table>','<table id="records-table">')}
  `);
  const form=$('#reconciliation-form');
  if(!accounts.length){form.querySelector('button[type="submit"]').disabled=true;form.insertAdjacentHTML('afterbegin','<div class="notice">Add a bank account before starting reconciliation.</div>');}
  form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;const start=$('#recon-start').value,end=$('#recon-end').value;if(end<start){toast('Statement end date must be on or after the start date.');return;}const payload={bank_account_id:$('#recon-account').value,statement_start:start,statement_end:end,statement_closing_balance:Number($('#recon-closing').value),status:'draft',notes:$('#recon-notes').value.trim()||null,created_by:session.user.id};const {error}=await requireClient().from('bank_reconciliations').insert(payload);if(error){toast(`Could not create reconciliation: ${friendlyError(error)}`);return;}toast('Reconciliation session created.');await navigate('reconciliation');};
  $('#page-content').querySelectorAll('[data-recon-view]').forEach(btn=>btn.onclick=async()=>{const r=sessions.find(x=>String(x.id)===btn.dataset.reconView);if(!r)return;let lines=[];try{lines=await query('bank_statement_lines','id,transaction_date,description,reference,debit,credit,match_status,matched_journal_line_id','transaction_date');lines=lines.filter(x=>String(x.reconciliation_id)===String(r.id));}catch{}const a=accountMap.get(String(r.bank_account_id));$('#detail-title').textContent='BANK RECONCILIATION DETAILS';$('#detail-content').innerHTML=`<div class="detail-grid"><div class="detail-item"><small>BANK ACCOUNT</small><strong>${escapeHtml(a?.account_label||a?.bank_name||'—')}</strong></div><div class="detail-item"><small>STATEMENT PERIOD</small><strong>${date(r.statement_start)} – ${date(r.statement_end)}</strong></div><div class="detail-item"><small>STATEMENT CLOSING BALANCE</small><strong>${money(r.statement_closing_balance)}</strong></div><div class="detail-item"><small>STATUS</small><strong>${escapeHtml(r.status)}</strong></div></div><h3>Statement lines</h3>${tableHtml(['Date','Description','Reference','Debit','Credit','Match status'],lines.map(x=>`<tr><td>${date(x.transaction_date)}</td><td>${escapeHtml(x.description||'—')}</td><td>${escapeHtml(x.reference||'—')}</td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td>${escapeHtml(x.match_status)}</td></tr>`))}<p class="muted">Statement-line import and final reconciliation approval should be completed only after matching each line against posted bank ledger entries.</p>`;$('#detail-dialog').showModal();});
}

async function exceptions() {
  $('#page-content').innerHTML = panel('Accounting exceptions', `
    <div class="notice">The accounting-exceptions RPC is not present in the current schema.</div>
    <p>Use the trial balance and audit history for the checks currently available. A dedicated exception report should be added as a database function before relying on it for month-end close.</p>
  `);
}

/* ===================== BACKUP / USERS / SETTINGS ===================== */
async function backup() {
  $('#page-content').innerHTML = panel('Backup & recovery', `
    <div class="notice">The downloadable JSON is a convenience export and is not a substitute for a complete database/storage backup or point-in-time recovery.</div>
    <p>Only an administrator should handle exported files. Store backups in an encrypted, access-controlled location.</p>
    <button class="primary" id="make-backup">Download data snapshot</button>
    <p id="backup-status" class="muted"></p>
  `);
  $('#make-backup').onclick = async () => {
    try {
      await logDownload('data_snapshot', null, 'json');
      await createJsonBackup();
      $('#backup-status').textContent = 'Export generated. Verify the file and keep it secure.';
    } catch (e) {
      toast('Backup export failed.');
      console.error(e);
    }
  };
}

async function passwordPage() {
  const admin = isAdmin();
  let usersList = [];
  if (admin) {
    try {
      usersList = await query('profiles', 'id,display_name,email,role,active,mobile', 'display_name') || [];
    } catch { usersList = []; }
  }

  const userOptions = usersList
    .filter(u => u.active !== false)
    .map(u => {
      const self = String(u.id) === String(session.user.id);
      const label = `${u.display_name || u.email || 'User'}${self ? ' (you)' : ''} — ${u.email || ''}`;
      return `<option value="${escapeHtml(u.id)}" ${self ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

  const eyeOpen = 'assets/icons/eye-open.svg';
  const eyeClosed = 'assets/icons/eye-closed.svg';
  const html = `
    <div style="max-width:520px;margin:0 auto">
      <div class="password-hero">
        <h3>Password security</h3>
        <p id="password-mode-hint">Update your account password securely.</p>
      </div>
      <div class="password-card">
        <form id="password-form" class="form-grid" style="grid-template-columns:1fr" autocomplete="off">
          ${admin ? `
          <label class="field">User
            <select id="pw-target-user" required>
              ${userOptions || `<option value="${escapeHtml(session.user.id)}">Current user</option>`}
            </select>
            <small>Select yourself to change your own password, or another user to set a new password for them.</small>
          </label>` : ''}
          <label class="field" id="pw-current-wrap">Current password *
            <div class="password-field">
              <input id="pw-current" type="password" autocomplete="current-password" minlength="1">
              <button type="button" class="password-toggle" data-for="pw-current" aria-label="Show password" aria-pressed="false"><img src="assets/icons/eye-closed.svg" alt=""></button>
            </div>
          </label>
          <label class="field">New password *
            <div class="password-field">
              <input id="pw-new" type="password" autocomplete="new-password" required minlength="12" placeholder="At least 12 characters">
              <button type="button" class="password-toggle" data-for="pw-new" aria-label="Show password" aria-pressed="false"><img src="assets/icons/eye-closed.svg" alt=""></button>
            </div>
          </label>
          <label class="field">Verify password *
            <div class="password-field">
              <input id="pw-verify" type="password" autocomplete="new-password" required minlength="12" placeholder="Re-enter new password">
              <button type="button" class="password-toggle" data-for="pw-verify" aria-label="Show password" aria-pressed="false"><img src="assets/icons/eye-closed.svg" alt=""></button>
            </div>
          </label>
          <div class="field">
            <button class="primary" type="submit" id="pw-save">Update password</button>
            <p class="muted small" id="pw-status" aria-live="polite"></p>
          </div>
        </form>
      </div>
    </div>`;

  $('#page-content').innerHTML = panel('PASSWORD', html);

  const currentWrap = $('#pw-current-wrap');
  const currentInput = $('#pw-current');
  const targetSelect = $('#pw-target-user');
  const hint = $('#password-mode-hint');

  function syncMode() {
    const targetId = targetSelect ? targetSelect.value : session.user.id;
    const isSelf = String(targetId) === String(session.user.id);
    if (isSelf) {
      currentWrap.style.display = '';
      currentInput.required = true;
      currentInput.value = '';
      hint.textContent = 'You are changing your own password. Current password is required.';
    } else {
      currentWrap.style.display = 'none';
      currentInput.required = false;
      currentInput.value = '';
      hint.textContent = 'Administrator mode: set a new password for the selected user. Their current password is not required.';
    }
  }
  if (targetSelect) {
    targetSelect.onchange = syncMode;
    syncMode();
  } else {
    hint.textContent = 'Enter your current password, then choose a new password.';
    currentInput.required = true;
  }

  document.querySelectorAll('#password-form .password-toggle').forEach(btn => {
    const input = document.getElementById(btn.dataset.for);
    bindPasswordReveal(input, btn);
  });

  $('#password-form').onsubmit = async (e) => {
    e.preventDefault();
    const status = $('#pw-status');
    const btn = $('#pw-save');
    const targetId = targetSelect ? targetSelect.value : session.user.id;
    const isSelf = String(targetId) === String(session.user.id);
    const current = currentInput.value;
    const next = $('#pw-new').value;
    const verify = $('#pw-verify').value;
    status.textContent = '';

    if (next.length < 12) { status.textContent = 'New password must be at least 12 characters.'; return; }
    if (next !== verify) { status.textContent = 'New password and verification do not match.'; return; }
    if (isSelf && !current) { status.textContent = 'Current password is required.'; return; }
    if (isSelf && next === current) { status.textContent = 'New password must be different from the current password.'; return; }

    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      if (isSelf) {
        const email = session.user.email;
        const { error: reAuthError } = await requireClient().auth.signInWithPassword({ email, password: current });
        if (reAuthError) throw new Error('Current password is incorrect.');
        const { error } = await requireClient().auth.updateUser({ password: next });
        if (error) throw error;
        status.textContent = 'Your password was updated successfully.';
        toast('Password updated.');
      } else {
        if (!admin) throw new Error('Only the administrator can change another user’s password.');
        const target = usersList.find(u => String(u.id) === String(targetId));
        if (!target) throw new Error('Selected user was not found.');
        // Load existing permissions so we do not wipe them
        let permissions = [];
        try {
          const { data: rows } = await requireClient().from('user_permissions').select('module_key,action_key,allowed').eq('user_id', targetId);
          permissions = (rows || []).map(r => ({ module_key: r.module_key, action_key: r.action_key, allowed: r.allowed === true }));
        } catch {}
        const payload = {
          action: 'update_user',
          user_id: targetId,
          display_name: target.display_name || target.email || 'User',
          mobile: target.mobile || '0000000000',
          role: String(target.role || 'STAFF').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STAFF',
          active: target.active !== false,
          password: next,
          permissions
        };
        // Ensure mobile meets edge validation if missing
        if (!payload.mobile || String(payload.mobile).length < 8) payload.mobile = '0000000000';
        const { data: response, error } = await requireClient().functions.invoke('admin-user-management', { body: payload });
        if (error) throw error;
        if (response?.error) throw new Error(response.error);
        status.textContent = `Password updated for ${target.display_name || target.email}.`;
        toast('User password updated.');
      }
      $('#pw-new').value = '';
      $('#pw-verify').value = '';
      if (currentInput) currentInput.value = '';
    } catch (err) {
      console.error(err);
      status.textContent = err.message || 'Could not update password.';
      toast('Password change failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update password';
    }
  };
}

async function users() {
  if (!isAdmin()) {
    return passwordPage();
  }
  const data = await query('profiles');
  const modules = NAV.map(n => n[1]);
  const actions = ['VIEW','ADD','EDIT','DELETE / VOID','DOWNLOAD','APPROVE'];
  const moduleRows = modules.map((m,i) => `<div class="permission-row"><label class="permission-module"><input type="checkbox" class="module-all" data-module="${i}" aria-label="Select all permissions for ${m}"><span>${m}</span></label><div class="permission-actions">${actions.map(a=>`<label class="permission-check"><input type="checkbox" data-permission-module="${i}" data-action="${a}" aria-label="${a} ${m}"><span>${a}</span></label>`).join('')}</div></div>`).join('');
  $('#page-content').innerHTML = `
    ${panel('USER MANAGEMENT', `<div class="notice"><strong>USER ADMINISTRATION</strong><br>Users are created by the administrator through a secure server process. Credentials are never exposed in this website.</div>
    <div class="panel-head"><h2>EXISTING USERS</h2><button class="secondary" id="goto-change-password" type="button">Change my password</button><button class="primary" id="show-add-user">+ ADD USER</button></div>
    ${tableHtml(['Name','Email','Role','Status','Manage'], data.map(r=>`<tr><td>${escapeHtml(r.display_name||'—')}</td><td>${escapeHtml(r.email||'—')}</td><td>${escapeHtml(String(r.role||'STAFF').toUpperCase())}</td><td>${r.active?'ACTIVE':'DISABLED'}</td><td><button class="secondary small-btn" data-edit-user="${escapeHtml(r.id||'')}">EDIT USER</button></td></tr>`))}
    <div id="user-editor" class="user-editor hidden" hidden>
      <div class="panel-head"><h2 id="user-editor-title">ADD USER</h2><button class="ghost" id="close-user-editor" type="button">CLOSE</button></div>
      <div class="form-grid">
        <label class="field">NAME<input id="user-first-name" autocomplete="given-name" maxlength="80" placeholder="First name" required></label>
        <label class="field">SURNAME<input id="user-surname" autocomplete="family-name" maxlength="80" placeholder="Surname" required></label>
        <label class="field">EMAIL<input id="user-email" type="email" autocomplete="email" maxlength="254" placeholder="user@example.com" required></label>
        <label class="field">MOBILE NUMBER<input id="user-mobile" type="tel" inputmode="tel" autocomplete="tel" pattern="\+?[0-9 ()\-]{8,18}" maxlength="18" placeholder="+91 9876543210" required></label>
        <label class="field wide">PROFILE PHOTO
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px">
            <span id="user-avatar-preview" class="user-avatar fallback" style="width:56px;height:56px;font-size:20px">U</span>
            <div>
              <input type="file" id="user-avatar-file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo">
              <small class="muted">JPEG, PNG or WebP · max 2 MB. Available when editing an existing user.</small>
              <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="secondary small-btn" id="user-avatar-upload">Upload photo</button>
                <button type="button" class="secondary small-btn" id="user-avatar-remove">Remove</button>
              </div>
              <p class="muted small" id="user-avatar-status" aria-live="polite"></p>
            </div>
          </div>
        </label>
        <label class="field">PASSWORD
          <div class="password-field">
            <input id="user-password" type="password" autocomplete="new-password" minlength="12" placeholder="At least 12 characters">
            <button type="button" class="password-toggle" id="toggle-user-password" aria-label="Show password" aria-pressed="false" title="Show password"><img src="assets/icons/eye-closed.svg" width="20" height="20" alt=""></button>
          </div>
          <small>Required for a new user. For an existing user, leave blank to keep their current password.</small>
        </label>
        <label class="field">ROLE<select id="user-role"><option value="STAFF">STAFF</option><option value="ADMIN">ADMIN</option></select></label>
        <label class="field">ACCOUNT STATUS<select id="user-active"><option value="true">ACTIVE</option><option value="false">DISABLED</option></select></label>
      </div>
      <div class="permission-header"><div><h2>MODULE PERMISSIONS</h2><p class="muted">No actions are selected by default for new users.</p></div><div class="toolbar"><button class="secondary small-btn" id="permissions-select-all" type="button">SELECT ALL</button><button class="secondary small-btn" id="permissions-clear" type="button">CLEAR ALL</button></div></div>
      <div class="permission-table">${moduleRows}</div>
      <div class="notice" style="margin-top:14px">Only assign ADMIN when necessary. Module/action permissions are stored here; enforcing each permission throughout all database policies and every application action is a separate security-hardening task.</div>
      <div class="dialog-actions"><button class="secondary" id="cancel-user-editor" type="button">CANCEL</button><button class="primary" id="save-user-preview" type="button">CREATE USER</button></div>
      <p id="user-editor-status" class="muted small" aria-live="polite"></p>
    </div>`)}
  `;
  const editor=$('#user-editor');
  const status=$('#user-editor-status');
  const resetEditor=()=>{
    editor.dataset.userId='';
    $('#user-editor-title').textContent='ADD USER';
    $('#save-user-preview').textContent='CREATE USER';
    $('#user-first-name').value=''; $('#user-surname').value=''; $('#user-email').value='';
    $('#user-email').disabled=false; $('#user-mobile').value=''; $('#user-password').value='';
    $('#user-role').value='STAFF'; $('#user-active').value='true'; $('#user-password').required=true;
    editor.querySelectorAll('[data-permission-module],.module-all').forEach(c=>c.checked=false);
    status.textContent='';
  };
  $('#goto-change-password')?.addEventListener('click', () => navigate('password'));
  $('#show-add-user').onclick=()=>{ resetEditor(); editor.hidden=false; editor.classList.remove('hidden'); editor.scrollIntoView({behavior:'smooth',block:'start'}); bindPasswordToggle(); };
  function bindPasswordToggle(){
    const btn=$('#toggle-user-password'); const input=$('#user-password');
    if(!btn||!input) return;
    delete btn.dataset.revealBound;
    bindPasswordReveal(input, btn);
  }
  bindPasswordToggle();
  $('#close-user-editor').onclick=$('#cancel-user-editor').onclick=()=>{ editor.hidden=true; editor.classList.add('hidden'); };
  $('#permissions-select-all').onclick=()=>{editor.querySelectorAll('input[type="checkbox"]').forEach(c=>c.checked=true);};
  $('#permissions-clear').onclick=()=>{editor.querySelectorAll('input[type="checkbox"]').forEach(c=>c.checked=false);};
  editor.querySelectorAll('.module-all').forEach(c=>c.onchange=()=>editor.querySelectorAll(`[data-permission-module="${c.dataset.module}"]`).forEach(a=>a.checked=c.checked));
  editor.querySelectorAll('[data-permission-module]').forEach(c=>c.onchange=()=>{const all=[...editor.querySelectorAll(`[data-permission-module="${c.dataset.permissionModule}"]`)];const master=editor.querySelector(`.module-all[data-module="${c.dataset.permissionModule}"]`);if(master)master.checked=all.every(a=>a.checked);});
  $('#save-user-preview').onclick=async()=>{
    const required=['user-first-name','user-surname','user-email','user-mobile','user-role','user-active'];
    const invalid=required.map(id=>$('#'+id)).find(el=>!el.checkValidity()||!el.value.trim());
    if(invalid){invalid.reportValidity();return;}
    const isEdit=Boolean(editor.dataset.userId);
    const password=$('#user-password').value;
    if(!isEdit && !password){$('#user-password').setCustomValidity('Enter a temporary password for the new user.');$('#user-password').reportValidity();$('#user-password').setCustomValidity('');return;}
    if(password && password.length<12){$('#user-password').setCustomValidity('Password must be at least 12 characters.');$('#user-password').reportValidity();$('#user-password').setCustomValidity('');return;}
    const permissions=modules.flatMap((module_key,i)=>actions.map(action_key=>({module_key,action_key,allowed:Boolean(editor.querySelector(`[data-permission-module="${i}"][data-action="${action_key}"]`)?.checked)})));
    const display_name=`${$('#user-first-name').value.trim()} ${$('#user-surname').value.trim()}`.replace(/\s+/g,' ');
    const payload={action:isEdit?'update_user':'create_user',display_name,email:$('#user-email').value.trim().toLowerCase(),mobile:$('#user-mobile').value.trim(),role:$('#user-role').value,active:$('#user-active').value==='true',permissions};
    if(isEdit) payload.user_id=editor.dataset.userId;
    if(password) payload.password=password;
    const button=$('#save-user-preview'); button.disabled=true; button.textContent=isEdit?'SAVING…':'CREATING…'; status.textContent='Saving securely…';
    try {
      const {data:response,error}=await requireClient().functions.invoke('admin-user-management',{body:payload});
      if(error) { let message=response?.error || error.message || 'The secure user-management function failed.'; try { const details=await error.context?.json?.(); if(details?.error) message=details.error; } catch {} throw new Error(message); }
      if(response?.error) throw new Error(response.error);
      toast(isEdit?'User updated successfully.':'User created successfully.');
      await navigate('users');
    } catch(e) {
      console.error('Secure user management failed',e);
      status.textContent=`Not saved: ${e.message || 'Unknown server error'}`;
      button.disabled=false; button.textContent=isEdit?'SAVE CHANGES':'CREATE USER';
    }
  };
  $('#page-content').querySelectorAll('[data-edit-user]').forEach(btn=>btn.onclick=async()=>{
    const row=data.find(r=>r.id===btn.dataset.editUser); if(!row)return;
    resetEditor(); editor.dataset.userId=row.id;
    $('#user-editor-title').textContent='EDIT USER'; $('#save-user-preview').textContent='SAVE CHANGES';
    $('#user-first-name').value=(row.display_name||'').trim().split(/\s+/)[0]||'';
    $('#user-surname').value=(row.display_name||'').trim().split(/\s+/).slice(1).join(' ');
    $('#user-email').value=row.email||''; $('#user-email').disabled=true; $('#user-mobile').value=row.mobile||'';
    $('#user-role').value=row.role||'STAFF'; $('#user-active').value=String(row.active===true); $('#user-password').required=false;
    status.textContent='Loading saved permissions…'; editor.hidden=false; editor.classList.remove('hidden'); editor.scrollIntoView({behavior:'smooth',block:'start'});
    try {
      const {data:rows,error}=await requireClient().from('user_permissions').select('module_key,action_key,allowed').eq('user_id',row.id);
      if(error) throw error;
      const saved=new Map((rows||[]).map(x=>[`${x.module_key}::${x.action_key}`,x.allowed===true]));
      editor.querySelectorAll('[data-permission-module]').forEach(c=>{const m=modules[Number(c.dataset.permissionModule)];c.checked=saved.get(`${m}::${c.dataset.action}`)===true;});
      editor.querySelectorAll('.module-all').forEach(c=>{const all=[...editor.querySelectorAll(`[data-permission-module="${c.dataset.module}"]`)];c.checked=all.length>0&&all.every(a=>a.checked);});
      status.textContent='';
    } catch(e) { status.textContent=`Could not load saved permissions: ${e.message}`; }
    // Profile photo preview + upload for this user
    const preview = $('#user-avatar-preview');
    const initial = ((row.display_name || row.email || 'U').trim().charAt(0) || 'U').toUpperCase();
    if (row.avatar_url) {
      preview.className = 'user-avatar';
      preview.innerHTML = `<img src="${escapeHtml(row.avatar_url)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover" onerror="this.remove()">`;
    } else {
      preview.className = 'user-avatar fallback';
      preview.style.width = '56px'; preview.style.height = '56px'; preview.style.fontSize = '20px';
      preview.textContent = initial;
    }
    const wireAvatar = (userId) => {
      $('#user-avatar-upload').onclick = async () => {
        const file = $('#user-avatar-file')?.files?.[0];
        const aStatus = $('#user-avatar-status');
        if (!userId) { aStatus.textContent = 'Save the user first, then upload a photo.'; return; }
        if (!file) { aStatus.textContent = 'Choose an image first.'; return; }
        if (file.size > 2 * 1024 * 1024) { aStatus.textContent = 'Image must be under 2 MB.'; return; }
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { aStatus.textContent = 'Use JPEG, PNG or WebP only.'; return; }
        aStatus.textContent = 'Uploading…';
        try {
          const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
          const { error: upErr } = await requireClient().storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
          if (upErr) throw upErr;
          let url = '';
          try {
            const { data: signed } = await requireClient().storage.from('avatars').createSignedUrl(path, 60 * 60 * 24 * 365);
            if (signed?.signedUrl) url = signed.signedUrl;
          } catch {}
          if (!url) {
            const { data: pub } = requireClient().storage.from('avatars').getPublicUrl(path);
            url = pub?.publicUrl || '';
          }
          const { error: prErr } = await requireClient().from('profiles').update({ avatar_url: url, avatar_path: path, updated_at: new Date().toISOString() }).eq('id', userId);
          if (prErr) throw prErr;
          preview.className = 'user-avatar';
          preview.innerHTML = `<img src="${escapeHtml(url)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover">`;
          aStatus.textContent = 'Photo saved.';
          toast('Profile photo updated.');
          row.avatar_url = url; row.avatar_path = path;
        } catch (e) {
          console.error(e);
          aStatus.textContent = e.message || 'Upload failed. Ensure the avatars bucket exists.';
        }
      };
      $('#user-avatar-remove').onclick = async () => {
        const aStatus = $('#user-avatar-status');
        if (!userId) return;
        try {
          if (row.avatar_path) await requireClient().storage.from('avatars').remove([row.avatar_path]);
          await requireClient().from('profiles').update({ avatar_url: null, avatar_path: null, updated_at: new Date().toISOString() }).eq('id', userId);
          preview.className = 'user-avatar fallback';
          preview.textContent = initial;
          preview.innerHTML = '';
          aStatus.textContent = 'Photo removed.';
          row.avatar_url = null; row.avatar_path = null;
        } catch (e) { aStatus.textContent = e.message || 'Could not remove photo.'; }
      };
    };
    wireAvatar(row.id);
  });
  // When adding a new user, avatar upload waits until after create
  $('#user-avatar-upload')?.addEventListener('click', () => {
    if (!editor.dataset.userId) $('#user-avatar-status').textContent = 'Create the user first, then edit to upload a photo.';
  });
}

async function settings() {
  let data = null;
  try {
    const res = await requireClient().from('company_settings').select('*').limit(1).maybeSingle();
    if (!res.error) data = res.data;
  } catch {}
  const companyName = data?.company_name || COMPANY.name;
  $('#page-content').innerHTML = panel('COMPANY SETTINGS', `
    <div class="settings-intro"><h3>Company profile</h3><p>Manage the details displayed on invoices, receipts and reports. Changes apply to new documents immediately.</p></div>
    <div class="notice">Company name is locked. GSTIN and tax rates are used on invoice PDFs when configured.</div>
    <form id="company-settings-form">
      <div class="settings-cards">
        <div class="settings-card">
          <h3>Identity &amp; contact</h3>
          <div class="form-grid">
            <label class="field">COMPANY NAME<input value="${escapeHtml(companyName)}" disabled aria-describedby="company-name-lock"><small id="company-name-lock">Company name cannot be edited.</small></label>
            <label class="field">ADDRESS<input id="setting-address" maxlength="250" value="${escapeHtml(data?.address || COMPANY.address)}" autocomplete="street-address"></label>
            <label class="field">EMAIL<input id="setting-email" type="email" maxlength="254" value="${escapeHtml(data?.email || COMPANY.emails[0])}" autocomplete="email"></label>
            <label class="field">MOBILE NUMBER<input id="setting-mobile" type="tel" inputmode="tel" pattern="\\+?[0-9 ()\\-]{8,18}" maxlength="18" value="${escapeHtml(data?.mobile || COMPANY.mobile)}" autocomplete="tel"></label>
            <label class="field">WEBSITE<input value="${escapeHtml(data?.website || COMPANY.website)}" disabled><small>Website editing was not requested.</small></label>
          </div>
        </div>
        <div class="settings-card">
          <h3>Tax &amp; period lock</h3>
          <div class="form-grid">
            <label class="field">GSTIN<input id="setting-gstin" maxlength="15" pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]" value="${escapeHtml(data?.gstin || COMPANY.gstin || '')}" placeholder="15-character GSTIN"><small>Leave blank if not configured.</small></label>
            <label class="field">SGST rate (%)<input id="setting-sgst" type="number" min="0" max="100" step="0.01" value="${escapeHtml(String(data?.sgst_rate ?? 9))}"></label>
            <label class="field">CGST rate (%)<input id="setting-cgst" type="number" min="0" max="100" step="0.01" value="${escapeHtml(String(data?.cgst_rate ?? 9))}"></label>
            <label class="field">IGST rate (%)<input id="setting-igst" type="number" min="0" max="100" step="0.01" value="${escapeHtml(String(data?.igst_rate ?? 18))}"></label>
            <label class="field">Period lock date <span class="muted small">(books closed up to this date)</span><input id="setting-period-lock" type="date" value="${escapeHtml(data?.period_lock_date || '')}"></label>
          </div>
        </div>
        <div class="settings-card" style="grid-column:1/-1">
          <h3>Payment instructions</h3>
          <div class="form-grid">
            <label class="field wide">Instructions shown on invoices<textarea id="setting-payment-instructions" rows="3">${escapeHtml(data?.payment_instructions || '')}</textarea></label>
          </div>
        </div>
      </div>
      <div class="field wide" style="margin-top:16px"><button class="primary" id="settings-review" type="button">SAVE COMPANY SETTINGS</button><p class="muted small" id="settings-status" aria-live="polite"></p></div>
    </form>
  `);
  $('#settings-review').onclick = async () => {
    const button = $('#settings-review');
    const status = $('#settings-status');
    button.disabled = true;
    button.textContent = 'Saving…';
    status.textContent = '';
    try {
      const payload = {
        company_name: companyName,
        address: $('#setting-address').value.trim(),
        email: $('#setting-email').value.trim(),
        mobile: $('#setting-mobile').value.trim(),
        gstin: $('#setting-gstin').value.trim().toUpperCase() || null,
        website: COMPANY.website,
        secondary_email: COMPANY.emails[1],
        payment_instructions: $('#setting-payment-instructions').value.trim() || null,
        sgst_rate: Number($('#setting-sgst').value) || 9,
        cgst_rate: Number($('#setting-cgst').value) || 9,
        igst_rate: Number($('#setting-igst').value) || 18,
        period_lock_date: $('#setting-period-lock').value || null,
        updated_by: session.user.id,
        updated_at: new Date().toISOString()
      };
      let result;
      if (data?.id) result = await requireClient().from('company_settings').update(payload).eq('id', data.id);
      else result = await requireClient().from('company_settings').insert(payload);
      if (result.error) throw result.error;
      status.textContent = 'Company settings saved. New invoices and receipts will use the updated details.';
      toast('Company settings saved.');
      data = { ...(data || {}), ...payload, id: data?.id };
    } catch (e) {
      console.error(e);
      status.textContent = `Could not save: ${e.message || 'Unknown error'}`;
      toast('Could not save company settings.');
    } finally {
      button.disabled = false;
      button.textContent = 'SAVE COMPANY SETTINGS';
    }
  };
}

/* ===================== HELPERS ===================== */
async function logDownload(documentType, recordId, fileFormat) {
  try {
    const { error } = await requireClient().rpc('log_download_event', {
      p_document_type: documentType,
      p_record_id: recordId,
      p_file_format: fileFormat,
      p_status: 'requested'
    });
    if (error) {
      console.error('Download event could not be recorded', error);
      // Do not block printing for logging failures
    }
  } catch (e) {
    console.warn('log_download_event failed', e);
  }
}

// Auth state listener
supabase?.auth.onAuthStateChange((event, s) => {
  if (event === 'SIGNED_OUT' || (!s && event === 'USER_DELETED')) {
    session = profile = null;
    showLogin();
  }
});

// Detail modal controls. Close buttons never submit or mutate a record.
$('#detail-close')?.addEventListener('click', () => $('#detail-dialog')?.close());
$('#detail-close-bottom')?.addEventListener('click', () => $('#detail-dialog')?.close());

// Compulsory refresh logout: do not restore an authenticated session after a reload.
const navEntry = performance.getEntriesByType?.('navigation')?.[0];
if (navEntry?.type === 'reload') {
  clearIdleLogout();
  supabase?.auth.signOut().catch(err => console.error('Refresh sign-out failed', err)).finally(() => { session = profile = null; showLogin(); });
} else {
  boot();
}
