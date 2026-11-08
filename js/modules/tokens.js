import { requireClient } from '../services/supabase.js';
import { escapeHtml, dateTimeIST, toast, localDateISO } from './utils.js';

const $ = s => document.querySelector(s);
const esc = escapeHtml;
let activeTab = 'generate';
let lastToken = null;

export async function tokenManagement() {
  const page = $('#page-content');
  page.innerHTML = `<section class="panel token-shell">
    <div class="panel-head"><div><h2>Candidate Visit &amp; Token Management</h2><p class="panel-subtitle">Register visits, issue tokens and review staff performance.</p></div></div>
    <div class="token-tabs" role="tablist"><button class="token-tab active" data-tab="generate">Generate Token</button><button class="token-tab" data-tab="ledger">Token Ledger</button><button class="token-tab" data-tab="performance">Performance Report</button></div>
    <div id="token-view"></div></section>`;
  page.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab=b.dataset.tab; page.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b)); renderTab(); });
  await renderTab();
}

async function renderTab() {
  if (activeTab==='generate') return renderGenerate();
  if (activeTab==='ledger') return renderLedger();
  return renderPerformance();
}

async function renderGenerate() {
  const view=$('#token-view');
  const client=requireClient();
  let staff=[];
  try { const {data,error}=await client.from('candidate_visits').select('consultant,coordinator').limit(1000); if(error) throw error; staff=data||[]; } catch(e) { console.warn('Staff suggestions unavailable',e); }
  const consultants=[...new Set(staff.map(x=>x.consultant).filter(Boolean))].sort();
  const coordinators=[...new Set(staff.map(x=>x.coordinator).filter(Boolean))].sort();
  view.innerHTML=`<div class="token-form-grid">
    <div class="token-form-main">
      <div class="token-section-title"><h3>Candidate details</h3><span class="muted small">Search by name, passport number or mobile number.</span></div>
      <label class="field wide">Search existing candidate<input id="token-candidate-search" placeholder="Search candidate by name, passport or mobile number" autocomplete="off"></label>
      <div id="candidate-search-results" class="candidate-search-results" hidden></div><div id="candidate-visit-history" class="candidate-visit-history" hidden></div>
      <form id="token-create-form" class="form-grid">
        <input type="hidden" name="candidate_id" id="token-candidate-id">
        <label class="field wide">Candidate name<input name="candidate_name" id="token-candidate-name" required maxlength="140"></label>
        <label class="field">Passport number<input name="passport_number" id="token-passport" required maxlength="40" autocomplete="off"></label>
        <label class="field">Mobile number<input name="mobile_number" id="token-mobile" type="tel" maxlength="25"></label>
        <label class="field">Country<input name="country" id="token-country" required maxlength="80" placeholder="Destination country"></label>
        <label class="field">Purpose of visit<input name="purpose_of_visit" id="token-purpose" maxlength="120" placeholder="e.g. Meeting"></label>
        <label class="field">Consultant<input name="consultant" list="token-consultants" required maxlength="120"><datalist id="token-consultants">${consultants.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="field">Coordinator<input name="coordinator" list="token-coordinators" required maxlength="120"><datalist id="token-coordinators">${coordinators.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></label>
        <div class="wide token-form-actions"><button class="primary" id="token-generate-btn" type="submit">Generate Token</button><button class="secondary" id="token-clear-btn" type="reset">Clear Form</button></div>
      </form>
    </div>
    <aside class="token-preview-panel"><div class="token-section-title"><h3>Latest token</h3></div><div id="latest-token-preview" class="token-empty">Your generated token will appear here.</div></aside>
  </div>`;
  const search=$('#token-candidate-search'), results=$('#candidate-search-results');
  let timer;
  search.oninput=()=>{ clearTimeout(timer); const q=search.value.trim(); if(q.length<1){results.hidden=true;return;} timer=setTimeout(async()=>{
    try { const {data,error}=await client.from('candidates').select('id,candidate_name,passport_number,mobile_number,country').or(`passport_number.ilike.%${q.replace(/[,%_]/g,'')}%,candidate_name.ilike.%${q.replace(/[,%_]/g,'')}%,mobile_number.ilike.%${q.replace(/[,%_]/g,'')}%`).limit(10); if(error) throw error;
      results.innerHTML=(data||[]).map(c=>`<button type="button" class="candidate-result" data-candidate="${esc(c.id)}"><strong>${esc(c.candidate_name)}</strong><span>${esc(c.passport_number)} · ${esc(c.country||'')}</span></button>`).join('')||'<p class="muted small">No matching candidate found. Enter details to create a new candidate.</p>';
      results.hidden=false; results.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>{const c=data.find(x=>x.id===b.dataset.candidate); if(!c)return; $('#token-candidate-id').value=c.id; $('#token-candidate-name').value=c.candidate_name||''; $('#token-passport').value=c.passport_number||''; $('#token-mobile').value=c.mobile_number||''; $('#token-country').value=c.country||''; results.hidden=true; search.value=`${c.candidate_name} · ${c.passport_number}`; loadCandidateHistory(c.id);});
    } catch(e){results.innerHTML=`<p class="error">Could not search candidates: ${esc(e.message)}</p>`;results.hidden=false;}
  },250);};
  $('#token-create-form').onsubmit=async e=>{e.preventDefault(); const form=e.currentTarget; if(!form.reportValidity())return; const btn=$('#token-generate-btn'); btn.disabled=true; btn.textContent='Generating…';
    const f=Object.fromEntries(new FormData(form).entries());
    try { const {data,error}=await client.rpc('generate_candidate_token',{p_candidate_id:f.candidate_id||null,p_candidate_name:f.candidate_name.trim(),p_passport_number:f.passport_number.trim(),p_mobile_number:f.mobile_number.trim()||null,p_country:f.country.trim(),p_consultant:f.consultant.trim(),p_coordinator:f.coordinator.trim(),p_purpose_of_visit:f.purpose_of_visit.trim()||null}); if(error)throw error;
      lastToken=Array.isArray(data)?data[0]:data; if(!lastToken?.token_number)throw new Error('Token was created but the token response was incomplete. Refresh the ledger to verify.');
      lastToken.generated_by_name=lastToken.created_by_name||'Current user';
      showLatestToken(lastToken); toast(`Token ${lastToken.token_number} generated successfully.`);
      form.reset(); $('#token-candidate-id').value=''; search.value=''; $('#candidate-visit-history').hidden=true;
    } catch(err){toast(err.message||'Token generation failed.'); console.error(err);} finally {btn.disabled=false;btn.textContent='Generate Token';}
  };
  $('#token-clear-btn').onclick=()=>{ $('#token-candidate-id').value=''; search.value=''; results.hidden=true; $('#candidate-visit-history').hidden=true; };
  async function loadCandidateHistory(candidateId){try{const {data,error}=await client.from('candidate_visits').select('token_number,created_at,status,consultant,coordinator').eq('candidate_id',candidateId).order('created_at',{ascending:false}).limit(20);if(error)throw error;const box=$('#candidate-visit-history');box.hidden=false;box.innerHTML=`<strong>Previous visit history (${(data||[]).length})</strong>${(data||[]).length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Token</th><th>Consultant</th><th>Coordinator</th><th>Status</th></tr></thead><tbody>${data.map(v=>`<tr><td>${esc(dateTimeIST(v.created_at))}</td><td>${esc(v.token_number)}</td><td>${esc(v.consultant)}</td><td>${esc(v.coordinator)}</td><td>${esc(v.status)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted small">No previous visits. This will be the first recorded visit.</p>'}`;toast('Existing candidate selected. A new visit token can now be generated.');}catch(e){console.warn('Candidate visit history unavailable',e);}}
  if(lastToken) showLatestToken(lastToken);
}

function showLatestToken(t) {
  const el=$('#latest-token-preview'); if(!el)return;
  const record={...t};
  el.innerHTML=`<div class="token-mini"><img class="receipt-logo" src="assets/avenix-logo.png" alt="Avenix Overseas logo"><div class="token-brand">AVENIX OVERSEAS</div><div class="token-kicker">Beyond Borders, We Build Pathways to Your Better Future</div><div class="token-number">${esc(record.token_number)}</div><div class="token-mini-details"><strong>${esc(record.candidate_name)}</strong><span>Passport Number: ${esc(record.passport_number)}</span><span>Mobile Number: ${esc(record.mobile_number||'—')}</span><span>Target Country: ${esc(record.country||'—')}</span><span>Purpose Of Visit: ${esc(record.purpose_of_visit||'—')}</span><span>Coordinator: ${esc(record.coordinator||'—')}</span><span>Consultant: ${esc(record.consultant||'—')}</span><span>Generated By: ${esc(record.generated_by_name||'—')}</span><span>${esc(dateTimeIST(record.created_at))}</span></div><div class="token-thanks">Thank you for taking the time to visit Avenix Overseas.<br>We truly appreciate your presence and look forward to serving you again.</div></div><div class="token-actions"><button class="primary" id="token-download">Download Token</button><button class="secondary" id="token-print">Print Token</button><button class="secondary" id="token-share">Share Token</button></div>`;
  $('#token-download').onclick=()=>printToken(record,true);
  $('#token-print').onclick=()=>printToken(record,false);
  $('#token-share').onclick=async()=>{const text=`AVENIX OVERSEAS\n${record.token_number}\nCandidate: ${record.candidate_name}\nPassport: ${record.passport_number}\nDate: ${dateTimeIST(record.created_at)}`; try {if(navigator.share) await navigator.share({title:'Avenix Overseas Visitor Token',text}); else {await navigator.clipboard.writeText(text);toast('Token details copied to clipboard.');}}catch(e){if(e.name!=='AbortError')toast('Sharing is not available on this device.');}};
}

function tokenPrintHtml(t) {
 return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.href}"><title>${esc(t.token_number)}</title><style>
 @page{size:100mm 140mm;margin:0}
 *{box-sizing:border-box;margin:0;padding:0}
 html,body{width:100mm;height:140mm;font-family:Arial,Helvetica,sans-serif;color:#10264d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .ticket{width:100mm;height:140mm;padding:3mm;background:#fff}
 .frame{height:100%;border:1.2mm solid #d5ad32;border-radius:6mm;padding:4mm 5mm 4.5mm;position:relative;text-align:center;display:flex;flex-direction:column}
 .frame:after{content:'';position:absolute;inset:1.1mm;border:0.35mm solid #e3e5e9;border-radius:4.5mm;pointer-events:none}
 .corners{display:flex;justify-content:space-between;color:#c99d20;font-size:13pt;line-height:1;margin:0 1mm}
 .head{display:flex;align-items:center;justify-content:center;gap:2.5mm;margin:1mm 0 1.5mm}
 .logo{width:17mm;height:17mm;object-fit:contain}
 .brand{text-align:left;font-size:13.5pt;font-weight:800;letter-spacing:.4px;line-height:1.15;color:#10264d}
 .tagline{font:italic 7.2pt Arial,sans-serif;color:#92734d;margin:0 0 2mm;line-height:1.3}
 .rule{border-top:.4mm solid #c99d20;margin:0 2mm 2.5mm}
 .label{font:8.5pt Arial,sans-serif;color:#727b8d;letter-spacing:.3px}
 .number{font:bold 15pt Arial,sans-serif;color:#10264d;margin:1mm 0;letter-spacing:.4px;overflow-wrap:anywhere}
 .datetime{font:8pt Arial,sans-serif;color:#727b8d;margin:0 0 2.5mm}
 .candidate{font:bold 13pt Arial,sans-serif;color:#10264d;margin:0 0 3.5mm;line-height:1.25}
 .details{display:grid;grid-template-columns:1fr 1fr;gap:3mm 3mm;text-align:left;font:8pt Arial,sans-serif;color:#5c6575;margin:0 1mm;flex:1 1 auto}
 .item{display:flex;flex-direction:column;gap:.5mm;min-width:0}
 .item span{color:#7a8494;font-size:7.2pt}
 .item b{color:#10264d;font-size:8.2pt;font-weight:700;overflow-wrap:anywhere;word-break:break-word}
 .footer{margin-top:auto;border-top:.3mm solid #e3e5e9;padding-top:2mm;font:italic 7.2pt Georgia,serif;line-height:1.35;color:#92734d}
 .gen{margin-top:1.2mm;font:7pt Arial,sans-serif;color:#8a93a3;font-style:normal}
 </style></head><body><main class="ticket"><section class="frame">
 <div class="corners"><span>◆</span><span>◆</span></div>
 <div class="head"><img class="logo" src="assets/avenix-logo.png" alt=""><div class="brand">AVENIX<br>OVERSEAS</div></div>
 <div class="tagline">Beyond Borders, We Build Pathways to Your Better Future</div>
 <div class="rule"></div>
 <div class="label">TOKEN NUMBER</div>
 <div class="number">${esc(t.token_number)}</div>
 <div class="datetime">${esc(dateTimeIST(t.created_at))}</div>
 <div class="candidate">${esc(t.candidate_name)}</div>
 <div class="details">
  <div class="item"><span>Passport Number</span><b>${esc(t.passport_number)}</b></div>
  <div class="item"><span>Mobile Number</span><b>${esc(t.mobile_number||'—')}</b></div>
  <div class="item"><span>Target Country</span><b>${esc(t.country||'—')}</b></div>
  <div class="item"><span>Purpose Of Visit</span><b>${esc(t.purpose_of_visit||'—')}</b></div>
  <div class="item"><span>Coordinator</span><b>${esc(t.coordinator||'—')}</b></div>
  <div class="item"><span>Consultant</span><b>${esc(t.consultant||'—')}</b></div>
 </div>
 <div class="footer">
  Thank you for taking the time to visit Avenix Overseas.<br>
  We truly appreciate your presence and look forward to serving you again.
  <div class="gen">Generated by ${esc(t.generated_by_name||'—')}</div>
 </div>
 </section></main><script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`;
}
function printToken(t,download){const w=window.open('','_blank','width=600,height=800');if(!w){toast('Allow pop-ups to print or save the token.');return;}w.document.open();w.document.write(tokenPrintHtml(t));w.document.close(); if(download)toast('Choose “Save as PDF” in the print dialog. Paper size is set to 100 × 140 mm.');}

async function renderLedger(){
 const view=$('#token-view'), client=requireClient();
 view.innerHTML=`<div class="token-ledger-actions"><label class="field token-universal-search">Search all records<input id="token-universal-search" autocomplete="off" placeholder="Type candidate, passport, token, consultant, coordinator, mobile or country"></label><span id="token-ledger-count" class="muted small"></span><button class="secondary" id="token-export">Export CSV</button></div><div id="token-search-suggestions" class="candidate-search-results" hidden></div><div id="token-ledger-table" class="loading">Loading token ledger…</div>`;
 let rows=[], profileMap={};
 try {
  const visits=await client.from('candidate_visits').select('*').order('created_at',{ascending:false}).limit(5000);
  if(visits.error)throw visits.error; rows=visits.data||[];
 }catch(e){$('#token-ledger-table').innerHTML=`<div class="notice">${esc(e.message)}<br>Ensure the Token Management database migration has been applied in Supabase.</div>`;return;}
 rows=rows.map(r=>({...r,generated_by_name:r.created_by_name||'—'}));
 const search=$('#token-universal-search'),suggestions=$('#token-search-suggestions');
 const render=()=>{
  const q=search.value.trim().toLowerCase();
  const fields=['candidate_name','passport_number','token_number','consultant','coordinator','mobile_number','country','generated_by_name'];
  const filtered=rows.filter(r=>!q||fields.some(k=>String(r[k]||'').toLowerCase().includes(q)));
  $('#token-ledger-count').textContent=`${filtered.length} matching visit(s) · ${rows.length} total`;
  $('#token-ledger-table').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Date &amp; Time</th><th>Token No.</th><th>Candidate</th><th>Passport No.</th><th>Consultant</th><th>Coordinator</th><th>Mobile No.</th><th>Country</th><th>Generated By</th><th>Status</th><th>Token</th></tr></thead><tbody>${filtered.length?filtered.map(r=>`<tr><td>${esc(dateTimeIST(r.created_at))}</td><td><strong>${esc(r.token_number)}</strong></td><td>${esc(r.candidate_name)}</td><td>${esc(r.passport_number)}</td><td>${esc(r.consultant)}</td><td>${esc(r.coordinator)}</td><td>${esc(r.mobile_number||'—')}</td><td>${esc(r.country||'—')}</td><td>${esc(r.generated_by_name)}</td><td><span class="pill ${r.status==='CANCELLED'?'void':'paid'}">${esc(r.status||'ACTIVE')}</span></td><td><button class="secondary small-btn" data-token-row="${esc(r.id)}">Print / PDF</button></td></tr>`).join(''):'<tr><td colspan="11" class="empty">No matching visits found.</td></tr>'}</tbody></table></div>`;
  $('#token-ledger-table').querySelectorAll('[data-token-row]').forEach(b=>b.onclick=()=>{const r=filtered.find(x=>x.id===b.dataset.tokenRow);if(r)printToken(r,true);});
  if(q){const matches=filtered.slice(0,8);suggestions.innerHTML=matches.map(r=>`<button class="candidate-result" type="button" data-suggest="${esc(r.id)}"><strong>${esc(r.candidate_name)} · ${esc(r.token_number)}</strong><span>${esc(r.passport_number)} · ${esc(r.mobile_number||'')} · ${esc(r.consultant)} / ${esc(r.coordinator)}</span></button>`).join('');suggestions.hidden=!matches.length;suggestions.querySelectorAll('[data-suggest]').forEach(b=>b.onclick=()=>{const r=rows.find(x=>x.id===b.dataset.suggest);if(r){search.value=r.token_number;render();suggestions.hidden=true;}});}else suggestions.hidden=true;
 };
 search.addEventListener('input',render);render();
 $('#token-export').onclick=()=>{const csv=[['Date & Time','Token No.','Candidate','Passport No.','Consultant','Coordinator','Mobile No.','Country','Generated By','Status'],...rows.map(r=>[r.created_at,r.token_number,r.candidate_name,r.passport_number,r.consultant,r.coordinator,r.mobile_number,r.country,r.generated_by_name,r.status])].map(a=>a.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='avenix-token-ledger.csv';a.click();URL.revokeObjectURL(a.href);};
}

async function renderPerformance(){const view=$('#token-view');view.innerHTML='<div class="loading">Loading performance…</div>';try{const {data,error}=await requireClient().from('candidate_visits').select('consultant,coordinator,candidate_id,created_at,status').limit(10000);if(error)throw error;const rows=data||[];const today=localDateISO();const month=today.slice(0,7);const build=key=>{const m=new Map();rows.filter(r=>r.status!=='CANCELLED').forEach(r=>{const name=r[key]||'Unassigned';const x=m.get(name)||{name,total:0,today:0,month:0,unique:new Set()};x.total++;if(String(r.created_at).slice(0,10)===today)x.today++;if(String(r.created_at).slice(0,7)===month)x.month++;x.unique.add(r.candidate_id);m.set(name,x);});return [...m.values()].sort((a,b)=>b.total-a.total);};const table=arr=>`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Total Visits</th><th>Today</th><th>This Month</th><th>Unique Candidates</th></tr></thead><tbody>${arr.length?arr.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.total}</td><td>${x.today}</td><td>${x.month}</td><td>${x.unique.size}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">No performance data yet.</td></tr>'}</tbody></table></div>`;view.innerHTML=`<div class="notice">Performance is attributed to the consultant and coordinator recorded on each individual visit. Cancelled tokens are excluded.</div>${panelHtml('Consultant Performance',table(build('consultant')))}${panelHtml('Coordinator Performance',table(build('coordinator')))}`;}catch(e){view.innerHTML=`<div class="notice">${esc(e.message)}<br>Apply the Token Management migration to enable reporting.</div>`;}}
function panelHtml(title,body){return `<section class="token-report-panel"><h3>${title}</h3>${body}</section>`;}

export async function tokenDashboardStats(){try{const {data,error}=await requireClient().from('candidate_visits').select('candidate_id,created_at,status').limit(10000);if(error)throw error;const rows=(data||[]).filter(r=>r.status!=='CANCELLED');const today=localDateISO(),month=today.slice(0,7);return {total:rows.length,today:rows.filter(r=>String(r.created_at).slice(0,10)===today).length,month:rows.filter(r=>String(r.created_at).slice(0,7)===month).length,unique:new Set(rows.map(r=>r.candidate_id)).size};}catch(e){console.warn('Token dashboard stats unavailable',e);return null;}}
