export const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));

/** Indian business timezone. Store instants as ISO timestamps; render business dates in Asia/Kolkata. */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

/** Return YYYY-MM-DD for India, independent of the computer/browser timezone. */
export const localDateISO = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** Format a database date or timestamp as an Indian business date without UTC day shifts. */
export const date = d => {
  if (!d) return '—';
  const value = String(d);
  // A SQL DATE has no timezone; parse its calendar components as a UTC date solely for display.
  const pure = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pure) && (value.length === 10 || !/[T ]/.test(value))) {
    const [y, m, day] = pure.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(Date.UTC(y, m - 1, day, 12)));
  }
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
};

/** Format an instant in Indian Standard Time. */
export const dateTimeIST = d => {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short', hour12: true
  }).format(parsed).replace(/\b(am|pm)\b/gi, m => m.toUpperCase()) + ' IST';
};

/** Format just the time component in Indian Standard Time. */
export const timeIST = d => {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: true
  }).format(parsed) + ' IST';
};

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const mask = s => s ? '••••' + String(s).slice(-4) : '—';

export function toast(message) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

export function downloadText(name, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function csv(rows) {
  return rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
}

export function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const cls = s.includes('paid') || s.includes('completed') || s.includes('posted') ? 'paid'
    : s.includes('void') || s.includes('cancel') ? 'void' : '';
  return `<span class="pill ${cls}">${escapeHtml(status || '—')}</span>`;
}
