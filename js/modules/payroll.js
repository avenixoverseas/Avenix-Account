/**
 * Avenix Accounting — Payroll Management Module
 * Super Admin only. Integrates with existing utils, forms, and Supabase client.
 */
import { requireClient } from '../services/supabase.js';
import { money, date, dateTimeIST, localDateISO, escapeHtml, toast, statusPill } from './utils.js';
import { exportCsv, printDocument } from './reports.js';
import { COMPANY } from '../config.js';

const $ = s => document.querySelector(s);

function panel(title, body, action = '') {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
}

function monthStart(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatMonth(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

async function q(table, select = '*', order = 'created_at', ascending = false) {
  const { data, error } = await requireClient().from(table).select(select).order(order, { ascending }).limit(2000);
  if (error) throw error;
  return data || [];
}

/* ============================================================
   PAYROLL DASHBOARD
   ============================================================ */
export async function payrollDashboard() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading payroll dashboard…</div>';

  try {
    const [employees, batches, lines] = await Promise.all([
      q('employees', 'id, employment_status, department', 'created_at'),
      q('payroll_batches', '*', 'payroll_month'),
      q('payroll_lines', 'gross_salary, total_deductions, net_salary, payment_status, department, batch_id', 'created_at')
    ]);

    const active = employees.filter(e => String(e.employment_status).toUpperCase() === 'ACTIVE');
    const latestBatch = batches[0];
    const latestLines = latestBatch ? lines.filter(l => l.batch_id === latestBatch.id) : [];

    const totalGross = latestLines.reduce((s, l) => s + Number(l.gross_salary || 0), 0);
    const totalDed = latestLines.reduce((s, l) => s + Number(l.total_deductions || 0), 0);
    const totalNet = latestLines.reduce((s, l) => s + Number(l.net_salary || 0), 0);
    const paid = latestLines.filter(l => String(l.payment_status).toUpperCase() === 'PAID').reduce((s, l) => s + Number(l.net_salary || 0), 0);
    const pending = totalNet - paid;

    // Department distribution
    const deptMap = {};
    latestLines.forEach(l => {
      const d = l.department || 'Unassigned';
      deptMap[d] = (deptMap[d] || 0) + Number(l.net_salary || 0);
    });
    const deptRows = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);

    // Trend (last 6 batches)
    const trend = batches.slice(0, 6).reverse().map(b => ({
      label: formatMonth(b.payroll_month),
      net: Number(b.total_net || 0),
      status: b.status
    }));

    content.innerHTML = `
      <div class="stats-grid dashboard-stats">
        <article class="stat-card tone-blue"><span>Total Employees</span><strong>${employees.length}</strong><small>${active.length} active</small></article>
        <article class="stat-card tone-green"><span>Monthly Gross</span><strong>${money(totalGross)}</strong><small>${formatMonth(latestBatch?.payroll_month)}</small></article>
        <article class="stat-card tone-gold"><span>Total Deductions</span><strong>${money(totalDed)}</strong><small>PF · ESI · TDS · PT etc.</small></article>
        <article class="stat-card tone-purple"><span>Net Payable</span><strong>${money(totalNet)}</strong><small>Paid ${money(paid)} · Pending ${money(pending)}</small></article>
      </div>
      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        ${panel('Department-wise Net Salary', deptRows.length ? `
          <table class="data-table"><thead><tr><th>Department</th><th class="num">Net Salary</th></tr></thead>
          <tbody>${deptRows.map(([d, v]) => `<tr><td>${escapeHtml(d)}</td><td class="num">${money(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payroll data yet.</p>')}
        ${panel('Recent Payroll Batches', batches.length ? `
          <table class="data-table"><thead><tr><th>Month</th><th>Status</th><th class="num">Net</th></tr></thead>
          <tbody>${batches.slice(0, 8).map(b => `<tr><td>${formatMonth(b.payroll_month)}</td><td>${statusPill(b.status)}</td><td class="num">${money(b.total_net)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No batches yet. Create one under Monthly Payroll.</p>')}
      </div>
      ${panel('Payroll Trend (Net)', trend.length ? `
        <div class="trend-bars" style="display:flex;align-items:flex-end;gap:12px;height:140px;padding:12px 0">
          ${trend.map(t => {
            const max = Math.max(...trend.map(x => x.net), 1);
            const h = Math.round((t.net / max) * 100);
            return `<div style="flex:1;text-align:center"><div style="background:var(--blue);height:${h}%;min-height:4px;border-radius:6px 6px 0 0;margin-bottom:6px" title="${money(t.net)}"></div><small>${escapeHtml(t.label)}</small></div>`;
          }).join('')}
        </div>` : '<p class="muted">Trend will appear after multiple payroll runs.</p>')}
    `;
  } catch (err) {
    console.error(err);
    content.innerHTML = panel('Payroll Dashboard', `<p class="muted">Unable to load payroll data. Ensure the payroll SQL has been applied and you are signed in as Super Admin.</p><p class="muted">${escapeHtml(err.message || '')}</p>`);
  }
}

/* ============================================================
   EMPLOYEES
   ============================================================ */
export async function payrollEmployees() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading employees…</div>';

  try {
    let employees = await q('employees', '*', 'full_name', true);
    employees = employees.filter(e => !e.is_deleted);

    const renderTable = (rows) => {
      if (!rows.length) return '<p class="muted">No employees yet. Add your first employee.</p>';
      return `<div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Code</th><th>Name</th><th>Department</th><th>Designation</th>
          <th>Status</th><th>Joining</th><th></th>
        </tr></thead>
        <tbody>${rows.map(e => `
          <tr data-id="${e.id}">
            <td>${escapeHtml(e.employee_code || '')}</td>
            <td><strong>${escapeHtml(e.full_name || '')}</strong><br><small class="muted">${escapeHtml(e.email || '')}</small></td>
            <td>${escapeHtml(e.department || '—')}</td>
            <td>${escapeHtml(e.designation || '—')}</td>
            <td>${statusPill(e.employment_status)}</td>
            <td>${e.joining_date ? date(e.joining_date) : '—'}</td>
            <td class="actions">
              <button class="ghost small" data-action="view" data-id="${e.id}">View</button>
              <button class="ghost small" data-action="edit" data-id="${e.id}">Edit</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;
    };

    content.innerHTML = panel('Employees', `
      <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center">
        <input type="search" id="emp-search" placeholder="Search name, code, department…" style="flex:1;min-width:180px">
        <select id="emp-status-filter">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="RESIGNED">Resigned</option>
          <option value="TERMINATED">Terminated</option>
        </select>
        <button class="primary" id="emp-add">+ Add Employee</button>
        <button class="secondary" id="emp-export">Export CSV</button>
      </div>
      <div id="emp-table">${renderTable(employees)}</div>
    `, '');

    const applyFilter = () => {
      const q = ($('#emp-search')?.value || '').toLowerCase();
      const st = ($('#emp-status-filter')?.value || '').toUpperCase();
      const filtered = employees.filter(e => {
        const matchQ = !q || [e.full_name, e.employee_code, e.department, e.email, e.designation].some(v => String(v || '').toLowerCase().includes(q));
        const matchS = !st || String(e.employment_status || '').toUpperCase() === st;
        return matchQ && matchS;
      });
      $('#emp-table').innerHTML = renderTable(filtered);
      bindRowActions();
    };

    $('#emp-search')?.addEventListener('input', applyFilter);
    $('#emp-status-filter')?.addEventListener('change', applyFilter);
    $('#emp-export')?.addEventListener('click', () => {
      exportCsv('employees.csv', employees.map(e => ({
        Code: e.employee_code,
        Name: e.full_name,
        Email: e.email,
        Mobile: e.mobile,
        Department: e.department,
        Designation: e.designation,
        Status: e.employment_status,
        Joining: e.joining_date,
        PAN: e.pan_number ? '****' : '',
        UAN: e.uan_number ? '****' : ''
      })));
    });

    const openEmployeeForm = async (existing = null) => {
      const isEdit = !!existing;
      const fields = `
        <div class="payroll-form-section">
          <h3>1. Employee details</h3>
          <div class="payroll-form-grid">
            <label>Employee Code <span class="required">*</span>
              <input name="employee_code" value="${escapeHtml(existing?.employee_code || '')}" readonly ${isEdit ? '' : 'placeholder="Generated automatically on save"'}>
              <small class="field-hint">${isEdit ? 'Employee code cannot be changed.' : 'The next available AVXT code is assigned automatically.'}</small>
            </label>
            <label>Full Name <span class="required">*</span><input name="full_name" required value="${escapeHtml(existing?.full_name || '')}" autocomplete="name"></label>
            <label>Email<input type="email" name="email" value="${escapeHtml(existing?.email || '')}" autocomplete="email"></label>
            <label>Mobile<input type="tel" name="mobile" inputmode="tel" value="${escapeHtml(existing?.mobile || '')}" autocomplete="tel"></label>
            <label class="field-span-2">Address<textarea name="address" rows="2">${escapeHtml(existing?.address || '')}</textarea></label>
          </div>
        </div>
        <div class="payroll-form-section">
          <h3>2. Employment information</h3>
          <div class="payroll-form-grid">
            <label>Department<input name="department" value="${escapeHtml(existing?.department || '')}"></label>
            <label>Designation<input name="designation" value="${escapeHtml(existing?.designation || '')}"></label>
            <label>Joining Date<input type="date" name="joining_date" value="${existing?.joining_date || ''}"></label>
            <label>Employment Status
              <select name="employment_status">
                ${['ACTIVE','INACTIVE','ON_LEAVE','RESIGNED','TERMINATED'].map(s =>
                  `<option value="${s}" ${String(existing?.employment_status || 'ACTIVE').toUpperCase() === s ? 'selected' : ''}>${s.replaceAll('_',' ')}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="payroll-form-section">
          <h3>3. Bank & statutory details</h3>
          <div class="payroll-form-grid">
            <label>Bank Name<input name="bank_name" value="${escapeHtml(existing?.bank_name || '')}"></label>
            <label>Bank Account Number<input name="bank_account_number" inputmode="numeric" value="${escapeHtml(existing?.bank_account_number || '')}" autocomplete="off"></label>
            <label>IFSC Code<input name="bank_ifsc" autocapitalize="characters" value="${escapeHtml(existing?.bank_ifsc || '')}"></label>
            <label>PAN<input name="pan_number" autocapitalize="characters" value="${escapeHtml(existing?.pan_number || '')}" autocomplete="off"></label>
            <label>UAN<input name="uan_number" inputmode="numeric" value="${escapeHtml(existing?.uan_number || '')}"></label>
            <label>ESIC Number<input name="esic_number" value="${escapeHtml(existing?.esic_number || '')}"></label>
          </div>
        </div>
        <div class="payroll-form-section">
          <h3>4. Additional notes</h3>
          <label>Notes<textarea name="notes" rows="3">${escapeHtml(existing?.notes || '')}</textarea></label>
        </div>
      `;
      $('#dialog-title').textContent = isEdit ? 'Edit Employee' : 'Add Employee';
      $('#dialog-fields').innerHTML = fields;
      $('#record-dialog').showModal();

      $('#dialog-save').onclick = async () => {
        const form = $('#record-form');
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const payload = Object.fromEntries(fd.entries());
        if (!isEdit) delete payload.employee_code; // PostgreSQL trigger assigns the next AVXT code atomically.
        payload.updated_at = new Date().toISOString();
        try {
          if (isEdit) {
            const { error } = await requireClient().from('employees').update(payload).eq('id', existing.id);
            if (error) throw error;
            toast('Employee updated');
          } else {
            payload.created_at = new Date().toISOString();
            const { error } = await requireClient().from('employees').insert(payload);
            if (error) throw error;
            toast('Employee created');
          }
          $('#record-dialog').close();
          payrollEmployees();
        } catch (err) {
          toast(err.message || 'Save failed', 'error');
        }
      };
    };

    $('#emp-add')?.addEventListener('click', () => openEmployeeForm(null));

    function bindRowActions() {
      content.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.onclick = async () => {
          const emp = employees.find(e => e.id === btn.dataset.id);
          if (emp) openEmployeeForm(emp);
        };
      });
      content.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.onclick = async () => {
          const emp = employees.find(e => e.id === btn.dataset.id);
          if (!emp) return;
          $('#detail-title').textContent = emp.full_name;
          $('#detail-content').innerHTML = `
            <dl class="detail-grid">
              <dt>Code</dt><dd>${escapeHtml(emp.employee_code)}</dd>
              <dt>Email</dt><dd>${escapeHtml(emp.email || '—')}</dd>
              <dt>Mobile</dt><dd>${escapeHtml(emp.mobile || '—')}</dd>
              <dt>Department</dt><dd>${escapeHtml(emp.department || '—')}</dd>
              <dt>Designation</dt><dd>${escapeHtml(emp.designation || '—')}</dd>
              <dt>Status</dt><dd>${statusPill(emp.employment_status)}</dd>
              <dt>Joining</dt><dd>${emp.joining_date ? date(emp.joining_date) : '—'}</dd>
              <dt>Bank</dt><dd>${emp.bank_account_number ? '••••' + String(emp.bank_account_number).slice(-4) : '—'} ${escapeHtml(emp.bank_ifsc || '')}</dd>
              <dt>PAN</dt><dd>${emp.pan_number ? '••••' + String(emp.pan_number).slice(-4) : '—'}</dd>
              <dt>UAN</dt><dd>${emp.uan_number ? '••••' + String(emp.uan_number).slice(-4) : '—'}</dd>
              <dt>Notes</dt><dd>${escapeHtml(emp.notes || '—')}</dd>
            </dl>`;
          $('#detail-dialog').showModal();
        };
      });
    }
    bindRowActions();
  } catch (err) {
    console.error(err);
    content.innerHTML = panel('Employees', `<p class="muted">Unable to load employees. Apply payroll SQL and sign in as Super Admin.</p><p class="muted">${escapeHtml(err.message || '')}</p>`);
  }
}

/* ============================================================
   SALARY STRUCTURE
   ============================================================ */
export async function payrollSalaryStructure() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading salary structures…</div>';
  try {
    const employees = (await q('employees', 'id, employee_code, full_name, department, designation, employment_status, salary_structure_id', 'full_name', true))
      .filter(e => !e.is_deleted && String(e.employment_status || '').toUpperCase() === 'ACTIVE');
    const structures = await q('salary_structures', '*', 'name', true);
    const components = await q('salary_components', '*', 'display_order', true);

    const byStructure = {};
    components.forEach(c => {
      if (!byStructure[c.structure_id]) byStructure[c.structure_id] = [];
      byStructure[c.structure_id].push(c);
    });

    const empOptions = employees.map(e =>
      `<option value="${e.id}" data-structure="${e.salary_structure_id || ''}">${escapeHtml(e.employee_code)} — ${escapeHtml(e.full_name)}</option>`
    ).join('');

    content.innerHTML = panel('Salary Structure', `
      <p class="muted" style="margin-bottom:12px">Complete the sections in order. Gross salary, total deductions and net salary are calculated automatically.</p>
      <form id="ss-form" class="form-grid salary-structure-form" style="max-width:920px">
        <div class="payroll-form-section wide"><h3>1. Select employee</h3>
        <label class="field wide">Employee *
          <select id="ss-employee" required>
            <option value="">— Select staff —</option>
            ${empOptions || '<option value="" disabled>No active employees</option>'}
          </select>
        </label></div>
        <div class="wide salary-components-grid">
          <fieldset class="salary-component-card">
            <legend>2. Earnings</legend>
            <label>Basic Salary (₹)<input type="number" min="0" step="0.01" id="ss-basic" value="0"></label>
            <label>HRA (₹)<input type="number" min="0" step="0.01" id="ss-hra" value="0"></label>
            <label>Allowances (₹)<input type="number" min="0" step="0.01" id="ss-allowances" value="0"></label>
            <label>Bonuses / Incentives (₹)<input type="number" min="0" step="0.01" id="ss-bonus" value="0"></label>
            <label>Other Earnings (₹)<input type="number" min="0" step="0.01" id="ss-other-earn" value="0"></label>
            <p style="margin-top:10px;font-weight:700">Gross Salary: <span id="ss-gross">₹0.00</span></p>
          </fieldset>
          <fieldset class="salary-component-card">
            <legend>3. Deductions</legend>
            <label>PF (₹)<input type="number" min="0" step="0.01" id="ss-pf" value="0"></label>
            <label>ESI (₹)<input type="number" min="0" step="0.01" id="ss-esi" value="0"></label>
            <label>TDS (₹)<input type="number" min="0" step="0.01" id="ss-tds" value="0"></label>
            <label>Prof. Tax (₹)<input type="number" min="0" step="0.01" id="ss-pt" value="0"></label>
            <label>Other Deductions (₹)<input type="number" min="0" step="0.01" id="ss-other-ded" value="0"></label>
            <p style="margin-top:10px;font-weight:700">Total Deductions: <span id="ss-total-ded">₹0.00</span></p>
          </fieldset>
        </div>
        <p class="wide salary-net-summary">4. Net Salary: <span id="ss-net">₹0.00</span></p>
        <div class="wide" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="primary" id="ss-save">Save Salary Structure</button>
          <button type="button" class="secondary" id="ss-recalc">Recalculate</button>
        </div>
        <p class="muted wide" id="ss-status" aria-live="polite"></p>
      </form>
    `);

    const num = id => Number(document.getElementById(id)?.value || 0) || 0;
    const fmt = n => money(n);

    function recalc() {
      const gross = num('ss-basic') + num('ss-hra') + num('ss-allowances') + num('ss-bonus') + num('ss-other-earn');
      const ded = num('ss-pf') + num('ss-esi') + num('ss-tds') + num('ss-pt') + num('ss-other-ded');
      const net = Math.max(0, gross - ded);
      $('#ss-gross').textContent = fmt(gross);
      $('#ss-total-ded').textContent = fmt(ded);
      $('#ss-net').textContent = fmt(net);
      return { gross, ded, net };
    }

    ['ss-basic','ss-hra','ss-allowances','ss-bonus','ss-other-earn','ss-pf','ss-esi','ss-tds','ss-pt','ss-other-ded']
      .forEach(id => document.getElementById(id)?.addEventListener('input', recalc));
    $('#ss-recalc')?.addEventListener('click', recalc);

    function loadFromComponents(structureId) {
      const comps = byStructure[structureId] || [];
      const getAmt = code => {
        const c = comps.find(x => String(x.component_code || '').toUpperCase() === code);
        return c ? Number(c.amount || 0) : 0;
      };
      $('#ss-basic').value = getAmt('BASIC');
      $('#ss-hra').value = getAmt('HRA');
      $('#ss-allowances').value = getAmt('TA') + getAmt('MA') + getAmt('SA') + getAmt('OTHER_EARNING');
      $('#ss-bonus').value = getAmt('BONUS') + getAmt('INCENTIVE');
      $('#ss-other-earn').value = 0;
      $('#ss-pf').value = getAmt('PF');
      $('#ss-esi').value = getAmt('ESI');
      $('#ss-tds').value = getAmt('TDS');
      $('#ss-pt').value = getAmt('PT');
      $('#ss-other-ded').value = getAmt('OTHER_DEDUCTION') + getAmt('ADVANCE') + getAmt('LOAN');
      recalc();
    }

    $('#ss-employee')?.addEventListener('change', () => {
      const sel = $('#ss-employee');
      const opt = sel?.selectedOptions?.[0];
      const sid = opt?.dataset?.structure || '';
      if (sid) loadFromComponents(sid);
      else {
        ['ss-basic','ss-hra','ss-allowances','ss-bonus','ss-other-earn','ss-pf','ss-esi','ss-tds','ss-pt','ss-other-ded']
          .forEach(id => { const el = document.getElementById(id); if (el) el.value = 0; });
        recalc();
      }
    });

    $('#ss-save')?.addEventListener('click', async () => {
      const empId = $('#ss-employee')?.value;
      if (!empId) { toast('Select a staff member', 'error'); return; }
      const emp = employees.find(e => e.id === empId);
      if (!emp) return;
      const { gross, ded, net } = recalc();
      const status = $('#ss-status');
      status.textContent = 'Saving…';
      try {
        let structureId = emp.salary_structure_id;
        if (!structureId) {
          const { data: st, error: se } = await requireClient().from('salary_structures').insert({
            name: `Structure — ${emp.full_name}`,
            description: `Per-employee structure for ${emp.employee_code}`,
            is_template: false,
            employee_id: emp.id,
            is_active: true,
            effective_from: localDateISO()
          }).select('id').single();
          if (se) throw se;
          structureId = st.id;
          await requireClient().from('employees').update({ salary_structure_id: structureId, updated_at: new Date().toISOString() }).eq('id', emp.id);
          emp.salary_structure_id = structureId;
        } else {
          // clear old components
          await requireClient().from('salary_components').delete().eq('structure_id', structureId);
        }

        const rows = [
          { structure_id: structureId, component_type: 'EARNING', component_code: 'BASIC', component_name: 'Basic Salary', calculation_type: 'FIXED', amount: num('ss-basic'), is_statutory: false, display_order: 1 },
          { structure_id: structureId, component_type: 'EARNING', component_code: 'HRA', component_name: 'HRA', calculation_type: 'FIXED', amount: num('ss-hra'), is_statutory: false, display_order: 2 },
          { structure_id: structureId, component_type: 'EARNING', component_code: 'OTHER_EARNING', component_name: 'Allowances', calculation_type: 'FIXED', amount: num('ss-allowances'), is_statutory: false, display_order: 3 },
          { structure_id: structureId, component_type: 'EARNING', component_code: 'BONUS', component_name: 'Bonuses / Incentives', calculation_type: 'FIXED', amount: num('ss-bonus'), is_statutory: false, display_order: 4 },
          { structure_id: structureId, component_type: 'EARNING', component_code: 'OTHER_EARNING_2', component_name: 'Other Earnings', calculation_type: 'FIXED', amount: num('ss-other-earn'), is_statutory: false, display_order: 5 },
          { structure_id: structureId, component_type: 'DEDUCTION', component_code: 'PF', component_name: 'PF', calculation_type: 'FIXED', amount: num('ss-pf'), is_statutory: true, display_order: 10 },
          { structure_id: structureId, component_type: 'DEDUCTION', component_code: 'ESI', component_name: 'ESI', calculation_type: 'FIXED', amount: num('ss-esi'), is_statutory: true, display_order: 11 },
          { structure_id: structureId, component_type: 'DEDUCTION', component_code: 'TDS', component_name: 'TDS', calculation_type: 'FIXED', amount: num('ss-tds'), is_statutory: true, display_order: 12 },
          { structure_id: structureId, component_type: 'DEDUCTION', component_code: 'PT', component_name: 'Professional Tax', calculation_type: 'FIXED', amount: num('ss-pt'), is_statutory: true, display_order: 13 },
          { structure_id: structureId, component_type: 'DEDUCTION', component_code: 'OTHER_DEDUCTION', component_name: 'Other Deductions', calculation_type: 'FIXED', amount: num('ss-other-ded'), is_statutory: false, display_order: 14 },
        ];
        const { error: ce } = await requireClient().from('salary_components').insert(rows);
        if (ce) throw ce;

        // refresh local cache
        byStructure[structureId] = rows;
        const opt = $('#ss-employee')?.selectedOptions?.[0];
        if (opt) opt.dataset.structure = structureId;

        status.textContent = `Saved. Gross ${fmt(gross)} · Deductions ${fmt(ded)} · Net ${fmt(net)}`;
        toast('Salary structure saved');
      } catch (err) {
        console.error(err);
        status.textContent = err.message || 'Save failed';
        toast(err.message || 'Save failed', 'error');
      }
    });

    recalc();
  } catch (err) {
    content.innerHTML = panel('Salary Structure', `<p class="muted">${escapeHtml(err.message || 'Load failed')}</p>`);
  }
}

export async function payrollMonthly() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading monthly payroll…</div>';
  try {
    const [batches, employees] = await Promise.all([
      q('payroll_batches', '*', 'payroll_month'),
      q('employees', 'id, employee_code, full_name, department, designation, employment_status, salary_structure_id', 'full_name', true)
    ]);
    const activeEmps = employees.filter(e => String(e.employment_status).toUpperCase() === 'ACTIVE');

    content.innerHTML = panel('Monthly Payroll', `
      <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <label>Payroll Month <input type="month" id="pr-month" value="${monthStart().slice(0,7)}"></label>
        <button class="primary" id="pr-create">Create / Open Batch</button>
        <button class="secondary" id="pr-refresh">Refresh</button>
      </div>
      <div id="pr-batch-list">
        <table class="data-table"><thead><tr>
          <th>Code</th><th>Month</th><th>Status</th><th class="num">Employees</th>
          <th class="num">Gross</th><th class="num">Net</th><th></th>
        </tr></thead>
        <tbody>
          ${batches.length ? batches.map(b => `
            <tr>
              <td>${escapeHtml(b.batch_code)}</td>
              <td>${formatMonth(b.payroll_month)}</td>
              <td>${statusPill(b.status)}</td>
              <td class="num">${b.total_employees}</td>
              <td class="num">${money(b.total_gross)}</td>
              <td class="num">${money(b.total_net)}</td>
              <td>
                <button class="ghost small" data-open-batch="${b.id}">Open</button>
                ${String(b.status).toUpperCase() === 'PENDING_APPROVAL' || String(b.status).toUpperCase() === 'CALCULATED' ?
                  `<button class="primary small" data-approve-batch="${b.id}">Approve</button>
                   <button class="secondary small" data-reject-batch="${b.id}">Reject</button>` : ''}
              </td>
            </tr>`).join('') : '<tr><td colspan="7" class="muted">No payroll batches yet.</td></tr>'}
        </tbody></table>
      </div>
      <div id="pr-detail" style="margin-top:20px"></div>
    `);

    $('#pr-refresh')?.addEventListener('click', () => payrollMonthly());

    $('#pr-create')?.addEventListener('click', async () => {
      const monthVal = $('#pr-month')?.value;
      if (!monthVal) return toast('Select a month', 'error');
      const payroll_month = monthVal + '-01';
      const batch_code = `PR-${monthVal.replace('-', '')}`;
      try {
        // Check existing
        const existing = batches.find(b => b.payroll_month?.startsWith(monthVal) && !['CANCELLED','REJECTED'].includes(String(b.status).toUpperCase()));
        if (existing) {
          toast('Batch already exists for this month');
          openBatchDetail(existing.id);
          return;
        }
        const { data: batch, error } = await requireClient().from('payroll_batches').insert({
          batch_code,
          payroll_month,
          status: 'DRAFT',
          prepared_by: null,
          notes: 'Created from Monthly Payroll UI'
        }).select('*').single();
        if (error) throw error;

        // Load components for all employee structures
        const structureIds = [...new Set(activeEmps.map(e => e.salary_structure_id).filter(Boolean))];
        let comps = [];
        if (structureIds.length) {
          const { data: cdata } = await requireClient().from('salary_components').select('*').in('structure_id', structureIds);
          comps = cdata || [];
        }
        const compsByStruct = {};
        comps.forEach(c => {
          if (!compsByStruct[c.structure_id]) compsByStruct[c.structure_id] = [];
          compsByStruct[c.structure_id].push(c);
        });
        const amt = (list, code) => {
          const c = (list || []).find(x => String(x.component_code || '').toUpperCase() === code);
          return Number(c?.amount || 0);
        };
        const lines = activeEmps.map(e => {
          const list = compsByStruct[e.salary_structure_id] || [];
          const basic = amt(list, 'BASIC');
          const hra = amt(list, 'HRA');
          const allowances = amt(list, 'OTHER_EARNING') + amt(list, 'TA') + amt(list, 'MA') + amt(list, 'SA');
          const bonuses = amt(list, 'BONUS');
          const incentives = amt(list, 'INCENTIVE');
          const otherEarn = amt(list, 'OTHER_EARNING_2');
          const gross = basic + hra + allowances + bonuses + incentives + otherEarn;
          const pf = amt(list, 'PF');
          const esi = amt(list, 'ESI');
          const tds = amt(list, 'TDS');
          const pt = amt(list, 'PT');
          const otherDed = amt(list, 'OTHER_DEDUCTION') + amt(list, 'ADVANCE') + amt(list, 'LOAN');
          const totalDed = pf + esi + tds + pt + otherDed;
          const net = Math.max(0, gross - totalDed);
          return {
            batch_id: batch.id,
            employee_id: e.id,
            employee_code: e.employee_code,
            employee_name: e.full_name,
            department: e.department,
            designation: e.designation,
            paid_days: 30,
            unpaid_days: 0,
            basic_salary: basic,
            hra,
            allowances,
            bonuses,
            incentives,
            other_earnings: otherEarn,
            gross_salary: gross,
            pf_employee: pf,
            esi_employee: esi,
            tds,
            professional_tax: pt,
            salary_advance: 0,
            loan_deduction: 0,
            unpaid_leave_deduction: 0,
            other_deductions: otherDed,
            total_deductions: totalDed,
            net_salary: net,
            payment_status: 'PENDING',
            calculation_snapshot: { source: 'salary_structure', structure_id: e.salary_structure_id || null }
          };
        });
        if (lines.length) {
          const { error: le } = await requireClient().from('payroll_lines').insert(lines);
          if (le) throw le;
        }
        const totalGross = lines.reduce((s, l) => s + Number(l.gross_salary || 0), 0);
        const totalDed = lines.reduce((s, l) => s + Number(l.total_deductions || 0), 0);
        const totalNet = lines.reduce((s, l) => s + Number(l.net_salary || 0), 0);
        await requireClient().from('payroll_batches').update({
          total_employees: lines.length,
          total_gross: totalGross,
          total_deductions: totalDed,
          total_net: totalNet,
          status: 'CALCULATED',
          prepared_at: new Date().toISOString()
        }).eq('id', batch.id);
        toast(`Batch ${batch_code} created with ${lines.length} employees`);
        payrollMonthly();
      } catch (err) {
        toast(err.message || 'Create failed', 'error');
      }
    });

    async function openBatchDetail(batchId) {
      const { data: batch } = await requireClient().from('payroll_batches').select('*').eq('id', batchId).single();
      const { data: lines } = await requireClient().from('payroll_lines').select('*').eq('batch_id', batchId).order('employee_name');
      $('#pr-detail').innerHTML = panel(`Batch ${escapeHtml(batch?.batch_code || '')} — ${formatMonth(batch?.payroll_month)}`, `
        <p>Status: ${statusPill(batch?.status)} · Employees: ${lines?.length || 0}</p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>Code</th><th>Name</th><th>Dept</th><th class="num">Gross</th>
            <th class="num">Deductions</th><th class="num">Net</th><th>Pay Status</th>
          </tr></thead>
          <tbody>
            ${(lines || []).map(l => `<tr>
              <td>${escapeHtml(l.employee_code)}</td>
              <td>${escapeHtml(l.employee_name)}</td>
              <td>${escapeHtml(l.department || '—')}</td>
              <td class="num">${money(l.gross_salary)}</td>
              <td class="num">${money(l.total_deductions)}</td>
              <td class="num"><strong>${money(l.net_salary)}</strong></td>
              <td>${statusPill(l.payment_status)}</td>
            </tr>`).join('') || '<tr><td colspan="7">No lines</td></tr>'}
          </tbody>
        </table></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          ${['DRAFT','CALCULATED'].includes(String(batch?.status).toUpperCase()) ?
            `<button class="primary" id="pr-submit-approval">Submit for Approval</button>` : ''}
          ${['PENDING_APPROVAL','CALCULATED'].includes(String(batch?.status).toUpperCase()) ?
            `<button class="primary" id="pr-approve">Approve &amp; Pay</button>
             <button class="secondary" id="pr-reject">Reject</button>` : ''}
          <button class="secondary" id="pr-gen-payslips">Generate Payslips</button>
          ${['PENDING_APPROVAL','CALCULATED','APPROVED'].includes(String(batch?.status).toUpperCase()) ?
            `<label>${String(batch?.status).toUpperCase() === 'APPROVED' ? 'Pay from bank' : 'Bank account for approval'}
              <select id="pr-bank-account"><option value="">Select bank account…</option></select></label>
             ${String(batch?.status).toUpperCase() === 'APPROVED'
               ? '<button class="primary" id="pr-payroll-pay">Pay &amp; Post to Bank</button>'
               : ''}` : ''}
        </div>
      `);

      if (['PENDING_APPROVAL','CALCULATED','APPROVED'].includes(String(batch?.status).toUpperCase())) {
        const bankSelect = $('#pr-bank-account');
        const { data: bankAccounts, error: bankError } = await requireClient()
          .from('bank_accounts').select('id, bank_name, account_label, account_number, active')
          .eq('active', true).order('created_at', { ascending: true });
        if (bankError) throw bankError;
        (bankAccounts || []).forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          const suffix = a.account_number ? ` ••••${String(a.account_number).slice(-4)}` : '';
          opt.textContent = `${a.bank_name} — ${a.account_label}${suffix}`;
          bankSelect?.appendChild(opt);
        });
        $('#pr-payroll-pay')?.addEventListener('click', async () => {
          const bankAccountId = bankSelect?.value;
          if (!bankAccountId) { toast('Select the bank account to debit', 'error'); return; }
          if (!confirm(`Post payroll payment of ${money(batch.total_net)} from the selected bank account? This cannot be posted twice.`)) return;
          const payButton = $('#pr-payroll-pay');
          payButton.disabled = true;
          try {
            const { data: result, error: payError } = await requireClient().rpc('process_payroll_payment', {
              p_batch_id: batchId,
              p_bank_account_id: bankAccountId
            });
            if (payError) throw payError;
            toast(`Payroll payment posted. Reference: ${result?.payment_reference || result?.reference || 'Recorded'}`);
            payrollMonthly();
          } catch (err) {
            payButton.disabled = false;
            toast(err.message || 'Payroll payment failed', 'error');
          }
        });
      }

      $('#pr-submit-approval')?.addEventListener('click', async () => {
        await requireClient().from('payroll_batches').update({ status: 'PENDING_APPROVAL' }).eq('id', batchId);
        toast('Submitted for approval');
        payrollMonthly();
      });
      $('#pr-approve')?.addEventListener('click', async () => {
        const bankAccountId = $('#pr-bank-account')?.value;
        if (!bankAccountId) { toast('Select the bank account to debit before approval', 'error'); return; }
        if (!confirm(`Approve and pay payroll of ${money(batch.total_net)} from the selected bank account?`)) return;
        const approveButton = $('#pr-approve');
        approveButton.disabled = true;
        try {
          const { error: approveError } = await requireClient().from('payroll_batches').update({
            status: 'APPROVED',
            approved_at: new Date().toISOString()
          }).eq('id', batchId).eq('status', batch.status);
          if (approveError) throw approveError;
          const { error: auditError } = await requireClient().from('payroll_audit_log').insert({
            entity_type: 'BATCH', entity_id: batchId, action: 'APPROVE', notes: 'Approved and submitted for payment via UI'
          });
          if (auditError) throw auditError;
          const { data: result, error: payError } = await requireClient().rpc('process_payroll_payment', {
            p_batch_id: batchId, p_bank_account_id: bankAccountId
          });
          if (payError) throw payError;
          toast(`Payroll approved and paid. Reference: ${result?.payment_reference || 'Recorded'}`);
          payrollMonthly();
        } catch (err) {
          approveButton.disabled = false;
          toast(err.message || 'Approval/payment failed', 'error');
        }
      });
      $('#pr-reject')?.addEventListener('click', async () => {
        const reason = prompt('Rejection reason:') || 'Rejected by admin';
        await requireClient().from('payroll_batches').update({
          status: 'REJECTED',
          rejected_at: new Date().toISOString(),
          rejection_reason: reason
        }).eq('id', batchId);
        toast('Payroll rejected');
        payrollMonthly();
      });
      $('#pr-gen-payslips')?.addEventListener('click', async () => {
        for (const l of (lines || [])) {
          const num = `PS-${(batch.payroll_month || '').slice(0,7).replace('-','')}-${l.employee_code}`;
          await requireClient().from('payslips').upsert({
            payroll_line_id: l.id,
            employee_id: l.employee_id,
            batch_id: batchId,
            payslip_number: num,
            payroll_month: batch.payroll_month,
            generated_at: new Date().toISOString()
          }, { onConflict: 'payslip_number' });
        }
        toast('Payslip records generated. Use Payslips page to download PDFs.');
      });
    }

    content.querySelectorAll('[data-open-batch]').forEach(btn => {
      btn.onclick = () => openBatchDetail(btn.dataset.openBatch);
    });
    content.querySelectorAll('[data-approve-batch]').forEach(btn => {
      btn.onclick = async () => {
        await requireClient().from('payroll_batches').update({
          status: 'APPROVED', approved_at: new Date().toISOString()
        }).eq('id', btn.dataset.approveBatch);
        toast('Approved');
        payrollMonthly();
      };
    });
    content.querySelectorAll('[data-reject-batch]').forEach(btn => {
      btn.onclick = async () => {
        await requireClient().from('payroll_batches').update({
          status: 'REJECTED', rejected_at: new Date().toISOString(), rejection_reason: 'Rejected from list'
        }).eq('id', btn.dataset.rejectBatch);
        toast('Rejected');
        payrollMonthly();
      };
    });
  } catch (err) {
    content.innerHTML = panel('Monthly Payroll', `<p class="muted">${escapeHtml(err.message || 'Load failed')}</p>`);
  }
}

/* ============================================================
   DEDUCTIONS & ALLOWANCES (settings view)
   ============================================================ */
export async function payrollDeductions() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading settings…</div>';
  try {
    const settings = await q('payroll_settings', '*', 'setting_key', true);
    content.innerHTML = panel('Deductions & Allowances Configuration', `
      <p class="muted">Statutory rates and rules are stored in the database and are configurable. Do not hard-code rates in application logic.</p>
      <table class="data-table"><thead><tr><th>Key</th><th>Value (JSON)</th><th>Description</th></tr></thead>
      <tbody>
        ${settings.map(s => `<tr>
          <td><code>${escapeHtml(s.setting_key)}</code></td>
          <td><pre style="white-space:pre-wrap;font-size:.8rem;margin:0">${escapeHtml(JSON.stringify(s.setting_value, null, 2))}</pre></td>
          <td>${escapeHtml(s.description || '')}</td>
        </tr>`).join('') || '<tr><td colspan="3">No settings — apply SQL 01.</td></tr>'}
      </tbody></table>
      <p class="muted" style="margin-top:12px">Edit values via Supabase SQL Editor or extend this screen with an edit form. Changes affect future payroll calculations.</p>
    `);
  } catch (err) {
    content.innerHTML = panel('Deductions & Allowances', `<p class="muted">${escapeHtml(err.message || '')}</p>`);
  }
}

/* ============================================================
   PAYSLIPS
   ============================================================ */
export async function payrollPayslips() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading payslips…</div>';
  try {
    const { data: slips } = await requireClient().from('payslips')
      .select('*, payroll_lines(*), employees(full_name, employee_code, department)')
      .order('generated_at', { ascending: false })
      .limit(500);

    content.innerHTML = panel('Payslips', `
      <div class="toolbar" style="margin-bottom:12px">
        <button class="secondary" id="ps-refresh">Refresh</button>
      </div>
      <table class="data-table"><thead><tr>
        <th>Payslip #</th><th>Employee</th><th>Month</th><th class="num">Net</th><th>Generated</th><th></th>
      </tr></thead>
      <tbody>
        ${(slips || []).map(s => {
          const line = s.payroll_lines || {};
          const emp = s.employees || {};
          return `<tr>
            <td>${escapeHtml(s.payslip_number)}</td>
            <td>${escapeHtml(emp.full_name || line.employee_name || '—')} <small>${escapeHtml(emp.employee_code || '')}</small></td>
            <td>${formatMonth(s.payroll_month)}</td>
            <td class="num">${money(line.net_salary)}</td>
            <td>${s.generated_at ? dateTimeIST(s.generated_at) : '—'}</td>
            <td><button class="ghost small" data-print-ps="${s.id}">PDF / Print</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">No payslips yet. Generate from Monthly Payroll.</td></tr>'}
      </tbody></table>
    `);

    $('#ps-refresh')?.addEventListener('click', () => payrollPayslips());

    content.querySelectorAll('[data-print-ps]').forEach(btn => {
      btn.onclick = () => {
        const s = (slips || []).find(x => x.id === btn.dataset.printPs);
        if (!s) return;
        const line = s.payroll_lines || {};
        const emp = s.employees || {};
        const html = `
          <div class="avenix-payslip" style="font-family:DM Sans,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a;border:1.5px solid #c7a45f;outline:1px solid #eadbb9;outline-offset:-6px;min-height:900px;box-sizing:border-box">
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c7a45f;padding-bottom:12px;gap:16px">
              <div style="display:flex;align-items:center;gap:14px"><img src="${new URL('../../assets/avenix-logo.png', import.meta.url).href}" alt="Avenix logo" style="width:86px;height:70px;object-fit:contain"><div><strong style="font-size:1.25rem">${escapeHtml(COMPANY.name)}</strong><br><small>${escapeHtml(COMPANY.address)}</small></div></div>
              <div style="text-align:right"><strong>PAYSLIP</strong><br>${escapeHtml(s.payslip_number)}<br>${formatMonth(s.payroll_month)}</div>
            </div>
            <div style="margin:16px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div><b>Employee</b><br>${escapeHtml(emp.full_name || line.employee_name || '')}<br>${escapeHtml(emp.employee_code || line.employee_code || '')}</div>
              <div><b>Department</b><br>${escapeHtml(emp.department || line.department || '—')}<br>Paid days: ${line.paid_days ?? '—'}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:12px 0">
              <thead><tr style="background:#f5efe3"><th style="text-align:left;padding:8px">Earnings</th><th style="text-align:right;padding:8px">Amount</th><th style="text-align:left;padding:8px">Deductions</th><th style="text-align:right;padding:8px">Amount</th></tr></thead>
              <tbody>
                <tr><td style="padding:6px 8px">Basic</td><td style="text-align:right;padding:6px 8px">${money(line.basic_salary)}</td>
                    <td style="padding:6px 8px">PF</td><td style="text-align:right;padding:6px 8px">${money(line.pf_employee)}</td></tr>
                <tr><td style="padding:6px 8px">HRA</td><td style="text-align:right;padding:6px 8px">${money(line.hra)}</td>
                    <td style="padding:6px 8px">ESI</td><td style="text-align:right;padding:6px 8px">${money(line.esi_employee)}</td></tr>
                <tr><td style="padding:6px 8px">Allowances</td><td style="text-align:right;padding:6px 8px">${money(line.allowances)}</td>
                    <td style="padding:6px 8px">TDS</td><td style="text-align:right;padding:6px 8px">${money(line.tds)}</td></tr>
                <tr><td style="padding:6px 8px">Bonuses / Incentives</td><td style="text-align:right;padding:6px 8px">${money((line.bonuses||0)+(line.incentives||0))}</td>
                    <td style="padding:6px 8px">Prof. Tax</td><td style="text-align:right;padding:6px 8px">${money(line.professional_tax)}</td></tr>
                <tr><td style="padding:6px 8px">Other Earnings</td><td style="text-align:right;padding:6px 8px">${money(line.other_earnings)}</td>
                    <td style="padding:6px 8px">Other Deductions</td><td style="text-align:right;padding:6px 8px">${money((line.other_deductions||0)+(line.salary_advance||0)+(line.loan_deduction||0)+(line.unpaid_leave_deduction||0))}</td></tr>
              </tbody>
              <tfoot>
                <tr style="font-weight:700;border-top:2px solid #c7a45f">
                  <td style="padding:8px">Gross</td><td style="text-align:right;padding:8px">${money(line.gross_salary)}</td>
                  <td style="padding:8px">Total Deductions</td><td style="text-align:right;padding:8px">${money(line.total_deductions)}</td>
                </tr>
                <tr style="font-size:1.1rem">
                  <td colspan="3" style="padding:12px 8px;text-align:right">Net Salary Payable</td>
                  <td style="text-align:right;padding:12px 8px">${money(line.net_salary)}</td>
                </tr>
              </tfoot>
            </table>
            <p style="font-size:.8rem;color:#64748b">This is a computer-generated payslip for ${escapeHtml(COMPANY.name)}. Payment status: ${escapeHtml(line.payment_status || 'PENDING')}.</p>
          </div>`;
        printDocument('Payslip ' + s.payslip_number, html);
      };
    });
  } catch (err) {
    content.innerHTML = panel('Payslips', `<p class="muted">${escapeHtml(err.message || '')}</p>`);
  }
}

/* ============================================================
   SALARY REPORTS & HISTORY
   ============================================================ */
export async function payrollReports() {
  const content = $('#page-content');
  content.innerHTML = panel('Salary Reports', `
    <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <label>From <input type="month" id="sr-from"></label>
      <label>To <input type="month" id="sr-to"></label>
      <button class="primary" id="sr-run">Run Employee Salary Register</button>
      <button class="secondary" id="sr-export">Export CSV</button>
    </div>
    <div id="sr-out"><p class="muted">Select a date range and run the report.</p></div>
  `);

  let lastRows = [];
  $('#sr-run')?.addEventListener('click', async () => {
    const from = ($('#sr-from')?.value || '2020-01') + '-01';
    const to = ($('#sr-to')?.value || monthStart().slice(0,7)) + '-01';
    try {
      const { data, error } = await requireClient().rpc('employee_salary_register', { p_from: from, p_to: to });
      if (error) throw error;
      lastRows = data || [];
      $('#sr-out').innerHTML = lastRows.length ? `
        <table class="data-table"><thead><tr>
          <th>Code</th><th>Name</th><th>Dept</th><th>Month</th>
          <th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th><th>Status</th>
        </tr></thead>
        <tbody>${lastRows.map(r => `<tr>
          <td>${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.employee_name)}</td>
          <td>${escapeHtml(r.department || '—')}</td>
          <td>${formatMonth(r.payroll_month)}</td>
          <td class="num">${money(r.gross_salary)}</td>
          <td class="num">${money(r.total_deductions)}</td>
          <td class="num">${money(r.net_salary)}</td>
          <td>${statusPill(r.payment_status)}</td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted">No rows for the selected period.</p>';
    } catch (err) {
      // Fallback without RPC
      try {
        const { data: lines } = await requireClient().from('payroll_lines')
          .select('*, payroll_batches!inner(payroll_month, status)')
          .limit(1000);
        lastRows = (lines || []).filter(l => {
          const m = l.payroll_batches?.payroll_month;
          return m && m >= from && m <= to;
        }).map(l => ({
          employee_code: l.employee_code,
          employee_name: l.employee_name,
          department: l.department,
          payroll_month: l.payroll_batches.payroll_month,
          gross_salary: l.gross_salary,
          total_deductions: l.total_deductions,
          net_salary: l.net_salary,
          payment_status: l.payment_status
        }));
        $('#sr-out').innerHTML = lastRows.length ? `<table class="data-table">...` : '<p class="muted">No data (RPC unavailable; fallback also empty).</p>';
        // simplified re-render
        $('#sr-out').innerHTML = lastRows.length ? `
          <table class="data-table"><thead><tr>
            <th>Code</th><th>Name</th><th>Dept</th><th>Month</th>
            <th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th><th>Status</th>
          </tr></thead>
          <tbody>${lastRows.map(r => `<tr>
            <td>${escapeHtml(r.employee_code)}</td>
            <td>${escapeHtml(r.employee_name)}</td>
            <td>${escapeHtml(r.department || '—')}</td>
            <td>${formatMonth(r.payroll_month)}</td>
            <td class="num">${money(r.gross_salary)}</td>
            <td class="num">${money(r.total_deductions)}</td>
            <td class="num">${money(r.net_salary)}</td>
            <td>${statusPill(r.payment_status)}</td>
          </tr>`).join('')}</tbody></table>` : '<p class="muted">No rows.</p>';
      } catch (e2) {
        $('#sr-out').innerHTML = `<p class="muted">${escapeHtml(err.message || e2.message)}</p>`;
      }
    }
  });

  $('#sr-export')?.addEventListener('click', () => {
    if (!lastRows.length) return toast('Run a report first');
    exportCsv('salary-register.csv', lastRows);
  });
}

export async function payrollHistory() {
  const content = $('#page-content');
  content.innerHTML = '<div class="loading">Loading history…</div>';
  try {
    const logs = await q('payroll_audit_log', '*', 'performed_at');
    content.innerHTML = panel('Payroll History / Audit', `
      <table class="data-table"><thead><tr>
        <th>When</th><th>Entity</th><th>Action</th><th>Notes</th>
      </tr></thead>
      <tbody>
        ${logs.length ? logs.map(l => `<tr>
          <td>${dateTimeIST(l.performed_at)}</td>
          <td>${escapeHtml(l.entity_type)} <small>${escapeHtml(String(l.entity_id || '').slice(0,8))}</small></td>
          <td>${statusPill(l.action)}</td>
          <td>${escapeHtml(l.notes || '')}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="muted">No audit entries yet.</td></tr>'}
      </tbody></table>
    `);
  } catch (err) {
    content.innerHTML = panel('Payroll History', `<p class="muted">${escapeHtml(err.message || '')}</p>`);
  }
}
