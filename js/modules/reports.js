import { csv, downloadText, dateTimeIST } from './utils.js';
import { COMPANY } from '../config.js';

export function exportCsv(filename, headers, rows) {
  downloadText(filename, csv([headers, ...rows]));
}


/** Opens a branded, print-ready report. The browser's Print dialog can save the report as PDF. */
export function printReport(title, filename, headers, rows, from = '', to = '') {
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to print or save this report as PDF.'); return; }
  w.opener = null;
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const logoUrl = new URL('assets/avenix-logo.png', window.location.href).href;
  const table = `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const range = from || to ? `${from || '—'} to ${to || '—'}` : 'As of generation';
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(filename || title)}</title><style>
  @page{size:A4 landscape;margin:14mm}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;box-sizing:border-box}body{font:11px 'DM Sans',Arial,sans-serif;color:#17253b;margin:0}header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1769d2;padding:0 0 12px;margin-bottom:16px}header img{width:66px;height:66px;object-fit:contain}h1{font:700 22px Arial,sans-serif;color:#102b55;margin:0}h2{font:700 16px Arial,sans-serif;margin:16px 0 8px;color:#102b55}.meta{margin-left:auto;text-align:right;line-height:1.7;font-size:10px;color:#52627a}.brand-sub{font-size:11px;letter-spacing:2px;color:#1769d2;font-weight:700}table{border-collapse:collapse;width:100%;margin-top:15px}td,th{border:1px solid #cfd8e5;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#102b55;color:white;font-size:9px;letter-spacing:.04em;text-transform:uppercase}tr:nth-child(even) td{background:#f4f7fb}.footer{margin-top:24px;padding-top:8px;border-top:1px solid #ccd6e4;font-size:9px;color:#6a7890;display:flex;justify-content:space-between}.hint{font-size:9px;color:#6a7890}@media print{button{display:none}}
  </style></head><body><header><img src="${logoUrl}" alt="Avenix Overseas"><div><h1>AVENIX OVERSEAS</h1><div class="brand-sub">ACCOUNTS OFFICE</div><h2>${esc(title)}</h2></div><div class="meta"><div><strong>REPORT PERIOD</strong></div><div>${esc(range)}</div><div><strong>GENERATED</strong></div><div>${esc(dateTimeIST(new Date()))}</div></div></header>${table}<div class="footer"><span>${esc(COMPANY.address || 'India')} · ${esc(COMPANY.emails?.[0] || '')}</span><span>${esc(COMPANY.developer || '')}</span></div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
  w.document.close();
}

/**
 * Generic print helper (legacy / other documents)
 */
export function printDocument(title, html) {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to print this document.');
    return;
  }
  w.opener = null;
  w.document.write(`<!doctype html><html><head><title>${title}</title>
<style>
@page{size:A4 portrait;margin:12mm}
body{font:12px Arial,sans-serif;color:#17253b;margin:24px}
header{display:flex;gap:16px;align-items:center;border-bottom:2px solid #102b55;padding-bottom:12px}
header img{width:82px;height:82px;object-fit:contain}
h1{font-size:19px;margin:0}small{color:#555}
table{border-collapse:collapse;width:100%;margin-top:20px}
td,th{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}
.footer{margin-top:32px;border-top:1px solid #aaa;padding-top:10px;font-size:10px}
@media print{button{display:none}}
</style></head><body>${html}
<div class="footer">${COMPANY.developer || ''}</div>
<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/**
 * High-fidelity invoice print matching the Avenix sample design.
 * data should contain: invoice_no, invoice_date, client details, items[], totals, payment_method, purpose, received_by
 */
export function printInvoice(data) {
  const company = { ...COMPANY, ...(data.company || {}) };
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to print this document.');
    return;
  }
  w.opener = null;

  const logoUrl = company.logo_url || new URL('assets/avenix-logo.png', window.location.href).href;
  const website = String(company.website || 'https://avenixoverseas.com').trim();
  const websiteHref = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const itemsHtml = (data.items || []).map((item, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td>${esc(item.description)}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">${fmt(item.rate)}</td>
      <td style="text-align:right">${fmt(item.amount)}</td>
    </tr>`).join('');

  const subtotal = data.subtotal != null ? data.subtotal : (data.items || []).reduce((s, i) => s + Number(i.amount || 0), 0);
  const sgstRate = Number(data.sgst_rate ?? data.sgst_percent ?? 0);
  const cgstRate = Number(data.cgst_rate ?? data.cgst_percent ?? 0);
  const sgstAmount = data.sgst_amount != null ? Number(data.sgst_amount) : +(subtotal * sgstRate / 100).toFixed(2);
  const cgstAmount = data.cgst_amount != null ? Number(data.cgst_amount) : +(subtotal * cgstRate / 100).toFixed(2);
  const legacyGst = data.gst != null ? Number(data.gst) : 0;
  const hasSplitTax = data.sgst_amount != null || data.cgst_amount != null || data.sgst_rate != null || data.cgst_rate != null || data.sgst_percent != null || data.cgst_percent != null;
  const taxTotal = hasSplitTax ? sgstAmount + cgstAmount : legacyGst;
  const discount = Number(data.discount_amount ?? data.discount ?? 0);
  const total = data.total != null ? Number(data.total) : +(subtotal + taxTotal - discount).toFixed(2);
  const taxRows = hasSplitTax
    ? `<div class="row"><span class="lbl">SGST (${sgstRate}%)</span><span class="val">${fmt(sgstAmount)}</span></div><div class="row"><span class="lbl">CGST (${cgstRate}%)</span><span class="val">${fmt(cgstAmount)}</span></div>`
    : (legacyGst ? `<div class="row"><span class="lbl">GST</span><span class="val">${fmt(legacyGst)}</span></div>` : '');
  const discountRow = discount ? `<div class="row"><span class="lbl">Discount</span><span class="val">−${fmt(discount)}</span></div>` : '';

  const nameParts = (data.client_name || data.client_name_snapshot || '').trim().split(/\s+/);
  const firstName = data.client_first_name || nameParts[0] || '';
  const surname = data.client_surname || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${esc(data.invoice_no)} — Avenix Overseas</title>
<style>
  @page { size: A4; margin: 8mm; }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body {
    font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    color: #1a2a4a;
    font-size: 10.5px;
    line-height: 1.25;
    background: #fff;
  }
  /* Force branded backgrounds to survive Print / Save as PDF */
  .header, .cat-bar, .section-title, table.items th,
  .client-grid .lbl, .totals, .payment-note .box, .meta .val,
  .sigs, .sig-box, .footer-bar, .terms {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .invoice, .header, .bottom-grid, .sigs, .terms, table.items, .client-grid {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  html, body, .invoice { height: auto !important; max-height: 277mm; overflow: hidden; }
  @media print {
    html, body { margin: 0; padding: 0; }
    .invoice { border: none; }
    button, .no-print { display: none !important; }
  }
  .invoice {
    max-width: 210mm;
    margin: 0 auto;
    border: 1px solid #d0d8e8;
  }
  /* Header */
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 8px 12px 6px;
    background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);
    border-bottom: 3px solid #1769d2;
    position: relative;
  }
  .header::after {
    content: '';
    position: absolute;
    bottom: -3px;
    left: 0; right: 0;
    height: 6px;
    background: linear-gradient(90deg, #e4a92d, #1769d2, #e4a92d);
  }
  .logo-block { display: flex; align-items: center; gap: 12px; }
  .logo-block img { width: 48px; height: 48px; object-fit: contain; }
  .brand-text h1 {
    font-size: 18px;
    font-weight: 800;
    color: #102b55;
    letter-spacing: 1px;
    margin: 0;
  }
  .brand-text .tag {
    font-size: 10px;
    color: #1769d2;
    font-weight: 600;
    margin-top: 2px;
  }
  .contact-block {
    text-align: right;
    font-size: 9.5px;
    color: #334;
    line-height: 1.35;
  }
  .contact-block strong { color: #102b55; }
  .contact-block .icon { color: #1769d2; margin-right: 4px; }
  .contact-block a { color: #1769d2; text-decoration: none; }

  /* Category bar */
  .cat-bar {
    background: linear-gradient(90deg, #102b55, #1769d2);
    color: #fff;
    text-align: center;
    padding: 4px 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1px;
  }
  .cat-bar span { margin: 0 10px; opacity: 0.9; }

  /* Title + meta */
  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px 4px;
  }
  .title-row h2 {
    font-size: 18px;
    font-weight: 800;
    color: #102b55;
    letter-spacing: 1px;
  }
  .meta {
    text-align: right;
    font-size: 10px;
  }
  .meta .row { margin-bottom: 4px; }
  .meta .label { color: #556; margin-right: 6px; }
  .meta .val {
    display: inline-block;
    background: #eef4ff;
    border: 1px solid #b8d0f0;
    border-radius: 4px;
    padding: 2px 10px;
    font-weight: 600;
    min-width: 140px;
    text-align: left;
  }

  /* Client details */
  .section-title {
    background: #1769d2;
    color: #fff;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.5px;
  }
  .client-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    padding: 0;
    font-size: 12px;
    border: 1px solid #cfd8e8;
    border-top: none;
  }
  .client-field {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 0;
    min-width: 0;
    border-bottom: 1px solid #e4eaf3;
    border-right: 1px solid #e4eaf3;
  }
  .client-field:nth-child(even) { border-right: none; }
  .client-field.wide { grid-column: 1 / -1; border-right: none; }
  .client-grid .lbl {
    color: #445;
    font-weight: 600;
    padding: 4px 8px;
    background: #f4f7fb;
    border-right: 1px solid #e4eaf3;
    display: flex;
    align-items: center;
  }
  .client-grid .val {
    color: #1a2a4a;
    font-weight: 500;
    padding: 8px 12px;
    overflow-wrap: anywhere;
    display: flex;
    align-items: center;
  }
  @media (max-width: 600px) {
    .client-grid { grid-template-columns: 1fr; }
    .client-field.wide { grid-column: auto; }
    .header { flex-wrap: wrap; gap: 10px; }
    .contact-block { text-align: left; }
    .title-row { flex-wrap: wrap; gap: 8px; }
    .bottom-grid { grid-template-columns: 1fr; }
    .sigs { gap: 10px; padding: 12px; }
    table.items th, table.items td { padding: 5px 4px; font-size: 10px; }
  }

  /* Items table */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
  }
  table.items th {
    background: #102b55;
    color: #fff;
    padding: 4px 6px;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  table.items td {
    padding: 3px 6px;
    border-bottom: 1px solid #e0e8f0;
    font-size: 10px;
  }
  table.items tr:nth-child(even) td { background: #f7fafc; }
  table.items .num { text-align: center; width: 40px; }
  table.items .amt { text-align: right; white-space: nowrap; }

  /* Totals + payment note */
  .bottom-grid {
    display: grid;
    grid-template-columns: 1fr 240px;
    gap: 0;
    border-top: 1px solid #d0d8e8;
  }
  .payment-note {
    padding: 6px 10px;
    font-size: 9.5px;
    color: #334;
  }
  .payment-note .box {
    border: 1px solid #b8d0f0;
    border-radius: 4px;
    padding: 6px 8px;
    background: #f8fbff;
  }
  .payment-note strong { color: #102b55; display: block; margin-bottom: 2px; }
  .totals {
    padding: 6px 10px;
    background: #f0f5fc;
  }
  .totals .row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    font-size: 10px;
  }
  .totals .row.grand {
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    background: #102b55;
    margin: 4px -10px 0;
    padding: 6px 10px;
    min-height: 28px;
    align-items: center;
    gap: 8px;
  }
  .totals .lbl { color: #445; }
  .totals .val { font-weight: 600; text-align:right; white-space:nowrap; }
  .totals .row:not(.grand) { min-height:18px; align-items:center; gap:8px; }
  .totals .row.grand + .row { margin-top:4px; }
  .totals .row.grand .lbl, .totals .row.grand .val { color:#fff; font-weight:800; }

  /* Terms */
  .terms {
    padding: 6px 10px 4px;
    font-size: 9px;
    color: #333;
  }
  .terms h4 {
    background: #102b55;
    color: #fff;
    display: inline-block;
    padding: 2px 8px;
    font-size: 9.5px;
    margin-bottom: 4px;
    border-radius: 2px;
  }
  .terms ul { padding-left: 14px; margin: 0; }
  .terms li { margin-bottom: 1px; }

  /* Signature area — compact so page 2 is not needed */
  .sigs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 6px 10px 6px;
  }
  .sig-box {
    border: 1px solid #c0cce0;
    border-radius: 4px;
    min-height: 52px;
    position: relative;
  }
  .sig-box .head {
    background: #102b55;
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    padding: 3px 8px;
    text-align: center;
  }
  .sig-box .body {
    padding: 4px 8px 4px;
    text-align: center;
    min-height: 28px;
  }
  .sig-box .name {
    font-weight: 700;
    font-size: 11px;
    color: #102b55;
    margin-top: 2px;
  }
  .sig-box .line {
    border-top: 1px dashed #99a;
    margin: 8px 12px 2px;
  }
  .sig-box .caption {
    font-size: 8.5px;
    color: #667;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  /* Footer band */
  .footer-band {
    background: linear-gradient(90deg, #102b55, #1769d2);
    color: #fff;
    text-align: center;
    padding: 4px;
    font-size: 9px;
    letter-spacing: 0.4px;
  }

  @media print {
    body { margin: 0; }
    .invoice { border: none; }
    button { display: none !important; }
  }
</style>
</head>
<body>
<div class="invoice">
  <!-- Header -->
  <div class="header">
    <div class="logo-block">
      <img src="${logoUrl}" alt="Avenix Overseas" onerror="this.style.display='none'">
      <div class="brand-text">
        <h1>AVENIX</h1>
        <div style="font-size:14px;font-weight:700;color:#1769d2;letter-spacing:3px;margin-top:-2px">OVERSEAS</div>
        <div class="tag">${esc(company.tagline || 'Beyond Borders, We Build Pathways to Your Better Future.')}</div>
      </div>
    </div>
    <div class="contact-block">
      <div><span class="icon">📍</span> ${esc(company.address)}</div>
      <div><span class="icon">✉</span> ${esc(company.emails?.[0] || 'contact@avenixoverseas.com')}</div>
      <div><span class="icon">✉</span> ${esc(company.emails?.[1] || 'info@avenixoverseas.com')}</div>
      <div><span class="icon">☎</span> ${esc(company.mobile)}</div>
      <div><span class="icon">🌐</span> <a href="${esc(websiteHref)}" target="_blank" rel="noopener noreferrer">${esc(website.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a></div>
      <div><span class="icon">🧾</span> GSTIN: ${esc(company.gstin || 'Not configured')}</div>
    </div>
  </div>

  <!-- Category bar -->
  <div class="cat-bar">
    <span>Study</span> / <span>Tourist</span> / <span>Business</span> / <span>Work</span>
  </div>

  <!-- Title + invoice meta -->
  <div class="title-row">
    <h2>INVOICE</h2>
    <div class="meta">
      <div class="row"><span class="label">Invoice Number :</span><span class="val">${esc(data.invoice_no || '—')}</span></div>
      <div class="row"><span class="label">Date &amp; Time :</span><span class="val">${esc(data.date_display || data.invoice_date || '—')}</span></div>
    </div>
  </div>

  <!-- Client details -->
  <div class="section-title">CLIENTS DETAILS</div>
  <div class="client-grid">
    <div class="client-field"><div class="lbl">Name</div><div class="val">${esc(firstName || '—')}</div></div>
    <div class="client-field"><div class="lbl">Surname</div><div class="val">${esc(surname || '—')}</div></div>
    <div class="client-field"><div class="lbl">Passport No.</div><div class="val">${esc(data.passport_number || '—')}</div></div>
    <div class="client-field"><div class="lbl">Destination Country</div><div class="val">${esc(data.destination_country || '—')}</div></div>
    <div class="client-field"><div class="lbl">Purpose</div><div class="val">${esc(data.purpose || '—')}</div></div>
    <div class="client-field"><div class="lbl">Client Address</div><div class="val">${esc(data.client_address || data.address || '—')}</div></div>
  </div>

  <!-- Line items -->
  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>DESCRIPTION</th>
        <th style="width:60px">QTY</th>
        <th style="width:100px">UNIT PRICE (INR)</th>
        <th style="width:100px">AMOUNT (INR)</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml || '<tr><td colspan="5" style="text-align:center;padding:16px">No items</td></tr>'}
    </tbody>
  </table>

  <!-- Payment note + totals -->
  <div class="bottom-grid">
    <div class="payment-note">
      <div class="box">
        <strong>💳 PAYMENT NOTE:</strong>
        ${data.payment_method ? `Payment Method: <strong>${esc(String(data.payment_method).replace(/_/g,' '))}</strong><br>` : ''}
        ${data.payment_note ? esc(data.payment_note) + '<br>' : ''}
        ${!data.payment_method && !data.payment_note ? 'No payment notes recorded.<br>' : ''}
        For any queries, please contact at info@avenixoverseas.com.
      </div>
    </div>
    <div class="totals">
      <div class="row"><span class="lbl">Sub Total (INR)</span><span class="val">${fmt(subtotal)}</span></div>
      ${taxRows}
      ${discountRow}
      <div class="row grand"><span>Total Amount (INR)</span><span>${fmt(total)}</span></div>
      ${(data.amount_received != null) ? `<div class="row"><span class="lbl">Amount Received (INR)</span><span class="val">${fmt(data.amount_received)}</span></div>` : ''}
      ${(data.balance_due != null) ? `<div class="row" style="background:#fff7ed;font-weight:700"><span class="lbl">Balance Due (INR)</span><span class="val">${fmt(data.balance_due)}</span></div>` : ''}
    </div>
  </div>

  <!-- Terms -->
  <div class="terms">
    <h4>TERMS &amp; CONDITIONS:</h4>
    <ul>
      <li>The client must provide accurate and complete documents as required for the visa process.</li>
      <li>Avenix Overseas will not be responsible for any delay or rejection caused by the embassy/consulate.</li>
      <li>The service charges are non-refundable once the process has started (except as per agreed terms).</li>
      <li>All payments must be made in advance or as per the agreed schedule.</li>
      <li>Avenix Overseas is only an assistance provider and does not guarantee visa approval, entry or results.</li>
      <li>Any additional charges (if applicable) will be informed separately.</li>
    </ul>
  </div>

  <!-- Signatures -->
  <div class="sigs">
    <div class="sig-box">
      <div class="head">Received By:</div>
      <div class="body">
        <div class="name">${esc(data.received_by || '—')}</div>
        <div class="line"></div>
        <div class="caption">SIGN</div>
      </div>
    </div>
    <div class="sig-box">
      <div class="head">For AVENIX OVERSEAS</div>
      <div class="body">
        <div class="name">${esc(data.authorized_signatory || 'Rohit Rawat')}</div>
        <div class="line"></div>
        <div class="caption">${esc(data.signatory_designation || 'MD')}</div>
      </div>
    </div>
  </div>

  <div class="footer-band">
    Beyond Borders, We Build Pathways to Your Better Future
  </div>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); }<\/script>
</body>
</html>`;

  w.document.write(html);
  w.document.close();

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(n) {
    return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

/** A4 expense voucher / bill — print-ready PDF via browser print. */
export function printExpenseVoucher(expense, preparedBy = '—') {
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to print this expense voucher.'); return; }
  w.opener = null;
  const esc = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const logoUrl = new URL('assets/avenix-logo.png', window.location.href).href;
  const voucherNo = expense.reference || expense.voucher_no || expense.id || '—';
  const when = expense.expense_date || expense.created_at || '—';
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Expense Voucher ${esc(voucherNo)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font:12px 'Segoe UI',Arial,sans-serif;color:#1a2a4a;margin:0}
.wrap{border:1px solid #cfd8e8;max-width:190mm;margin:0 auto}
.header{display:flex;align-items:center;gap:14px;padding:16px 18px;border-bottom:3px solid #1769d2;background:linear-gradient(180deg,#f8fbff,#fff)}
.header img{width:64px;height:64px;object-fit:contain}
h1{margin:0;font-size:22px;color:#102b55}
.tag{font-size:10px;color:#1769d2;font-weight:600}
.banner{background:#102b55;color:#fff;text-align:center;padding:8px;font-weight:700;letter-spacing:1px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #e4eaf3}
.cell{padding:10px 14px;border-right:1px solid #e4eaf3;border-bottom:1px solid #e4eaf3}
.cell:nth-child(even){border-right:none}
.lbl{font-size:10px;color:#556;font-weight:700;text-transform:uppercase}
.val{margin-top:4px;font-weight:600}
.amount{font-size:20px;color:#102b55}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:28px 18px 18px}
.sig{border-top:1px solid #99a;padding-top:8px;font-size:11px;color:#445}
.footer{padding:10px 18px;font-size:10px;color:#6a7890;border-top:1px solid #e4eaf3;display:flex;justify-content:space-between}
@media print{button{display:none}}
</style></head><body>
<div class="wrap">
  <div class="header">
    <img src="${logoUrl}" alt="Avenix Overseas" onerror="this.style.display='none'">
    <div><h1>AVENIX OVERSEAS</h1><div class="tag">Beyond Borders, We Build Pathways to Your Better Future.</div></div>
  </div>
  <div class="banner">EXPENSE VOUCHER</div>
  <div class="grid">
    <div class="cell"><div class="lbl">Voucher / Reference</div><div class="val">${esc(voucherNo)}</div></div>
    <div class="cell"><div class="lbl">Expense date</div><div class="val">${esc(when)}</div></div>
    <div class="cell"><div class="lbl">Category</div><div class="val">${esc(expense.category || '—')}</div></div>
    <div class="cell"><div class="lbl">Payment method</div><div class="val">${esc(expense.payment_method || '—')}</div></div>
    <div class="cell"><div class="lbl">Payee / Vendor</div><div class="val">${esc(expense.payee || '—')}</div></div>
    <div class="cell"><div class="lbl">Paid from</div><div class="val">${esc(expense.account_type || '')} ${esc(expense.account_id || '')}</div></div>
    <div class="cell" style="grid-column:1/-1;border-right:none"><div class="lbl">Description</div><div class="val">${esc(expense.description || '—')}</div></div>
    <div class="cell" style="grid-column:1/-1;border-right:none"><div class="lbl">Amount (INR)</div><div class="val amount">₹ ${fmt(expense.amount)}</div></div>
    <div class="cell"><div class="lbl">Prepared / recorded by</div><div class="val">${esc(preparedBy)}</div></div>
    <div class="cell"><div class="lbl">Status</div><div class="val">${esc(expense.status || 'Posted')}</div></div>
  </div>
  <div class="sigs">
    <div class="sig">Prepared by</div>
    <div class="sig">Authorised / Approved</div>
  </div>
  <div class="footer"><span>Avenix Overseas · Expense voucher</span><span>A4 · Print / Save as PDF</span></div>
</div>
<div style="text-align:center;padding:12px"><button onclick="window.print()" style="padding:10px 18px;font-weight:700;cursor:pointer">Print / Save as PDF</button></div>
</body></html>`);
  w.document.close();
}
