import { escapeHtml, localDateISO } from './utils.js';

/**
 * Open a modal form dialog.
 * fields: array of {name, label, type?, required?, options?, wide?, min?, step?, placeholder?, value?}
 */
export function openForm({ title, fields, submit, extraHtml = '' }) {
  const dlg = document.querySelector('#record-dialog');
  const formFields = document.querySelector('#dialog-fields');
  document.querySelector('#dialog-title').textContent = title;

  formFields.innerHTML = fields.map(f => {
    const req = f.required ? 'required' : '';
    const wide = f.wide ? 'wide' : '';
    const val = f.value != null ? ` value="${escapeHtml(String(f.value))}"` : '';
    const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
    const min = f.min !== undefined ? ` min="${f.min}"` : '';
    const step = f.step ? ` step="${f.step}"` : '';
    const pattern = f.pattern ? ` pattern="${escapeHtml(f.pattern)}"` : '';
    const title = f.title ? ` title="${escapeHtml(f.title)}"` : '';
    const maxLength = f.maxLength ? ` maxlength="${Number(f.maxLength)}"` : '';
    const autocomplete = f.autocomplete ? ` autocomplete="${escapeHtml(f.autocomplete)}"` : '';
    const readonly = f.readonly ? ' readonly' : '';
    const disabled = f.disabled ? ' disabled' : '';

    if (f.type === 'select') {
      const opts = (f.options || []).map(o =>
        `<option value="${escapeHtml(o.value)}" ${o.selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
      ).join('');
      const blank = f.required ? '<option value="">Select an option…</option>' : '';
      return `<label class="field ${wide}">${escapeHtml(f.label)}
        <select name="${escapeHtml(f.name)}" ${req}>${blank}${opts}</select>
      </label>`;
    }
    if (f.type === 'textarea') {
      return `<label class="field ${wide}">${escapeHtml(f.label)}
        <textarea name="${escapeHtml(f.name)}" rows="3" ${req}${ph}>${escapeHtml(f.value || '')}</textarea>
      </label>`;
    }
    if (f.type === 'hidden') {
      return `<input type="hidden" name="${escapeHtml(f.name)}" value="${escapeHtml(String(f.value || ''))}">`;
    }
    return `<label class="field ${wide}">${escapeHtml(f.label)}
      <input name="${escapeHtml(f.name)}" type="${f.type || 'text'}" ${req}${min}${step}${pattern}${title}${maxLength}${autocomplete}${readonly}${disabled}${ph}${val}>
    </label>`;
  }).join('') + (extraHtml || '');

  dlg.showModal();

  const save = document.querySelector('#dialog-save');
  const newSave = save.cloneNode(true);
  save.parentNode.replaceChild(newSave, save);

  newSave.onclick = async () => {
    const formEl = document.querySelector('#record-form');
    if (!formEl.reportValidity()) return;
    const data = Object.fromEntries(new FormData(formEl).entries());

    for (const f of fields) {
      if (f.required && !String(data[f.name] || '').trim()) {
        alert(`Please enter ${f.label}.`);
        return;
      }
      if (f.type === 'number' && data[f.name] !== undefined && data[f.name] !== '' && Number(data[f.name]) < 0) {
        alert(`${f.label} cannot be negative.`);
        return;
      }
    }

    newSave.disabled = true;
    newSave.textContent = 'Saving…';
    try {
      await submit(data);
      dlg.close();
    } catch (e) {
      alert(e.message || 'Unable to save this record. Please try again.');
    } finally {
      newSave.disabled = false;
      newSave.textContent = 'Save record';
    }
  };
}

/**
 * Specialized multi-line-item invoice creator form.
 */
export function openInvoiceForm({ clients, onSubmit }) {
  const dlg = document.querySelector('#record-dialog');
  const formFields = document.querySelector('#dialog-fields');
  document.querySelector('#dialog-title').textContent = 'Create Invoice / Bill';

  const clientOpts = clients.map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.full_name)}${c.passport_number ? ' · ' + escapeHtml(String(c.passport_number).slice(-6)) : ''}</option>`
  ).join('');



  formFields.innerHTML = `
    <label class="field wide">Client
      <select name="client_id" id="inv-client" required>
        <option value="">Select client…</option>
        ${clientOpts}
      </select>
    </label>
    <label class="field">Invoice Date
      <input name="invoice_date" type="date" required value="${localDateISO()}">
    </label>

    <div class="field wide" style="grid-column:1/-1;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong>Line Items</strong>
        <button type="button" class="secondary" id="add-line-item" style="padding:6px 12px;font-size:13px">+ Add item</button>
      </div>
      <div id="line-items">
        <div class="line-item" style="display:grid;grid-template-columns:1fr 90px 70px 100px 32px;gap:8px;margin-bottom:8px;align-items:end">
          <label>Description<input name="item_desc" required placeholder="Service description"></label>
          <label>HSN/SAC<input name="item_hsn" placeholder="e.g. 9983" maxlength="8"></label>
          <label>Qty<input name="item_qty" type="number" min="0.01" step="0.01" required value="1"></label>
          <label>Rate (₹)<input name="item_rate" type="number" min="0" step="0.01" required value="0"></label>
          <button type="button" class="ghost remove-line" title="Remove" style="padding:8px">✕</button>
        </div>
      </div>
      <p class="small muted" id="items-summary">GST defaults to 9% SGST + 9% CGST (configurable in Company Settings). Add HSN/SAC codes for GST compliance. Confirm rates with your tax professional.</p>
    </div>
  `;

  const itemsContainer = formFields.querySelector('#line-items');
  formFields.querySelector('#add-line-item').onclick = () => {
    const div = document.createElement('div');
    div.className = 'line-item';
    div.style.cssText = 'display:grid;grid-template-columns:1fr 90px 70px 100px 32px;gap:8px;margin-bottom:8px;align-items:end';
    div.innerHTML = `
      <label>Description<input name="item_desc" required placeholder="Service description"></label>
      <label>HSN/SAC<input name="item_hsn" placeholder="e.g. 9983" maxlength="8"></label>
      <label>Qty<input name="item_qty" type="number" min="0.01" step="0.01" required value="1"></label>
      <label>Rate (₹)<input name="item_rate" type="number" min="0" step="0.01" required value="0"></label>
      <button type="button" class="ghost remove-line" title="Remove" style="padding:8px">✕</button>
    `;
    itemsContainer.appendChild(div);
    div.querySelector('.remove-line').onclick = () => {
      if (itemsContainer.querySelectorAll('.line-item').length > 1) div.remove();
    };
  };
  itemsContainer.querySelectorAll('.remove-line').forEach(btn => {
    btn.onclick = () => {
      if (itemsContainer.querySelectorAll('.line-item').length > 1) btn.closest('.line-item').remove();
    };
  });

  dlg.showModal();

  const save = document.querySelector('#dialog-save');
  const newSave = save.cloneNode(true);
  save.parentNode.replaceChild(newSave, save);

  newSave.onclick = async () => {
    const formEl = document.querySelector('#record-form');
    if (!formEl.reportValidity()) return;
    const fd = new FormData(formEl);
    const client_id = fd.get('client_id');
    if (!client_id) { alert('Please select a client.'); return; }

    const descs = fd.getAll('item_desc');
    const hsns = fd.getAll('item_hsn');
    const qtys = fd.getAll('item_qty');
    const rates = fd.getAll('item_rate');
    const items = [];
    for (let i = 0; i < descs.length; i++) {
      const q = Number(qtys[i]);
      const r = Number(rates[i]);
      if (!descs[i]?.trim() || !(q > 0) || r < 0) {
        alert('Please fill all line items correctly (description, positive quantity, non-negative rate).');
        return;
      }
      items.push({ description: descs[i].trim(), hsn_sac: (hsns[i] || '').trim() || null, quantity: q, rate: r, amount: +(q * r).toFixed(2) });
    }
    if (!items.length) { alert('Add at least one line item.'); return; }
    if (items.reduce((sum, item) => sum + item.amount, 0) <= 0) { alert('Invoice line items must have a total greater than zero.'); return; }

    const payload = {
      client_id,
      invoice_date: fd.get('invoice_date'),
      items
    };

    newSave.disabled = true;
    newSave.textContent = 'Creating…';
    try {
      await onSubmit(payload);
      dlg.close();
    } catch (e) {
      alert(e.message || 'Unable to create invoice. Please try again.');
    } finally {
      newSave.disabled = false;
      newSave.textContent = 'Save record';
    }
  };
}
