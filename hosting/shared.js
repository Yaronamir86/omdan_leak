
const STORAGE_KEY = 'omdaIturCases';
const SETTINGS_KEY = 'omdaIturSettings';
const BILLING_KEY = 'omdaIturBilling';

const defaultSettings = {
  companyName: 'OMDA איתור',
  companySubtitle: 'מערכת ניהול למאתרי נזילות',
  inspectorName: '',
  professionalTitle: 'מאתר נזילות מוסמך',
  phone: '',
  email: '',
  city: '',
  signature: ''
};

const defaultBilling = {
  planName: 'Professional',
  status: 'פעיל',
  monthlyLimit: 50,
  renewalDate: '2026-05-01'
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const byId = (id) => document.getElementById(id);
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const readCases = () => readJson(STORAGE_KEY, []);
const readSettings = () => ({...defaultSettings, ...readJson(SETTINGS_KEY, {})});
const readBilling = () => ({...defaultBilling, ...readJson(BILLING_KEY, {})});
const fmtDate = (v) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('he-IL'); } catch { return v; } };
const statusClass = (status) => ({'טיוטה':'warn','נקבעה בדיקה':'blue','בבדיקה':'blue','ממתין להשלמה':'red','הושלם':'green'}[status] || 'warn');

function renderDashboard(){
  const table = byId('casesTable');
  if(!table) return;
  const q = (byId('searchInput')?.value || '').trim().toLowerCase();
  const status = byId('statusFilter')?.value || '';
  const type = byId('typeFilter')?.value || '';
  const cases = readCases().sort((a,b)=> String(b.date || '').localeCompare(String(a.date || '')));
  const rows = cases.filter(c => {
    const hay = [c.caseNumber,c.customerName,c.title,c.propertyType,c.issueType,c.city].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!status || c.status === status) && (!type || c.propertyType === type);
  });

  byId('statTotal').textContent = cases.length;
  byId('statActive').textContent = cases.filter(c => ['נקבעה בדיקה','בבדיקה'].includes(c.status)).length;
  byId('statDone').textContent = cases.filter(c => c.status === 'הושלם').length;
  byId('statPending').textContent = cases.filter(c => c.status === 'ממתין להשלמה').length;
  const month = new Date().toISOString().slice(0,7);
  byId('statMonth').textContent = cases.filter(c => String(c.date || '').startsWith(month)).length;

  if(!rows.length){
    table.innerHTML = `<tr><td colspan="7"><div class="empty-state">עדיין אין תיקים במערכת. לחץ על "תיק חדש" כדי להתחיל.</div></td></tr>`;
  } else {
    table.innerHTML = rows.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.caseNumber)}</strong></td>
        <td><strong>${escapeHtml(c.title || c.customerName || '')}</strong><div style="color:var(--muted);font-size:13px;margin-top:6px">${escapeHtml(c.customerName || '')}</div></td>
        <td>${escapeHtml(c.propertyType || '')}</td>
        <td>${escapeHtml(c.issueType || '')}</td>
        <td><span class="badge ${statusClass(c.status)}">${escapeHtml(c.status || '')}</span></td>
        <td>${fmtDate(c.date)}</td>
        <td><a class="btn btn-ghost btn-sm" href="case.html?id=${encodeURIComponent(c.id)}">פתח</a></td>
      </tr>`).join('');
  }

  byId('recentCases').innerHTML = cases.slice(0,5).map(c => `
    <div class="mini-item">
      <div>
        <strong>${escapeHtml(c.customerName || c.title || '')}</strong>
        <small>${escapeHtml(c.issueType || '')} · ${escapeHtml(c.address || c.city || '')}</small>
      </div>
      <span class="badge ${statusClass(c.status)}">${escapeHtml(c.status || '')}</span>
    </div>`).join('') || `<div class="empty-state">אין תיקים אחרונים להצגה.</div>`;
}

function newCaseData(){
  const seq = String(readCases().length + 1).padStart(3, '0');
  const now = new Date();
  const ymd = now.toISOString().slice(2,10).replaceAll('-','');
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    caseNumber: `ITR-${ymd}-${seq}`,
    date: now.toISOString().slice(0,10),
    customerName: '', contactName: '', phone: '', email: '',
    city: '', address: '', propertyType: 'דירת מגורים',
    issueType: '', referralSource: '', status: 'טיוטה',
    urgency: 'רגילה', inspectionArea: '', equipmentUsed: '',
    findings: '', leakSource: '', certainty: 'בינונית',
    collateralDamage: '', recommendation: '', immediateAction: '', summary: '', title: ''
  };
}

function getCurrentCase(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if(!id) return null;
  return readCases().find(c => c.id === id) || null;
}

function renderCase(){
  const form = byId('caseForm');
  if(!form) return;
  const current = getCurrentCase();
  const data = current || newCaseData();
  Object.entries(data).forEach(([k,v]) => { const el = form.elements[k]; if(el) el.value = v ?? ''; });
  byId('caseHeading').textContent = current ? 'ניהול תיק איתור' : 'תיק חדש';
  byId('caseSubheading').textContent = current ? 'עריכת תיק קיים במערכת.' : 'פתיחת תיק חדש במבנה זהה ל-OMDA רכוש, מותאם מקצועית לאיתור נזילות.';
  updatePreview();
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.id = current?.id || data.id;
    payload.title = payload.title || `איתור נזילות - ${payload.address || payload.city || payload.customerName || payload.caseNumber}`;
    const cases = readCases();
    const idx = cases.findIndex(c => c.id === payload.id);
    if(idx >= 0) cases[idx] = {...cases[idx], ...payload}; else cases.unshift(payload);
    writeJson(STORAGE_KEY, cases);
    location.href = 'dashboard.html';
  });
}

function updatePreview(){
  const form = byId('caseForm');
  const preview = byId('reportPreview');
  if(!form || !preview) return;
  const data = Object.fromEntries(new FormData(form).entries());
  preview.innerHTML = `
    <div class="kv-grid">
      <div class="kv-row"><span>מספר תיק</span><strong>${escapeHtml(data.caseNumber || '')}</strong></div>
      <div class="kv-row"><span>לקוח</span><strong>${escapeHtml(data.customerName || '')}</strong></div>
      <div class="kv-row"><span>סוג נכס</span><strong>${escapeHtml(data.propertyType || '')}</strong></div>
      <div class="kv-row"><span>סוג תקלה / חשד</span><strong>${escapeHtml(data.issueType || '')}</strong></div>
      <div class="kv-row"><span>מקור נזילה משוער</span><strong>${escapeHtml(data.leakSource || '')}</strong></div>
      <div class="kv-row"><span>רמת ודאות</span><strong>${escapeHtml(data.certainty || '')}</strong></div>
    </div>
    <div class="section" style="margin-top:18px"><div class="section-body"><div class="section-title-row">ממצאים</div><div style="margin-top:10px;color:var(--muted);line-height:1.8">${escapeHtml(data.findings || '') || '—'}</div></div></div>
    <div class="section" style="margin-top:18px"><div class="section-body"><div class="section-title-row">המלצה להמשך טיפול</div><div style="margin-top:10px;color:var(--muted);line-height:1.8">${escapeHtml(data.recommendation || '') || '—'}</div></div></div>`;
}

function renderSettings(){
  const form = byId('settingsForm');
  if(!form) return;
  const data = readSettings();
  Object.entries(data).forEach(([k,v]) => { const el = form.elements[k]; if(el) el.value = v ?? ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    writeJson(SETTINGS_KEY, Object.fromEntries(new FormData(form).entries()));
    byId('saveStatus').textContent = 'ההגדרות נשמרו';
    setTimeout(() => byId('saveStatus').textContent = '', 2500);
  });
}

function renderBilling(){
  const wrap = byId('billingWrap');
  if(!wrap) return;
  const plan = readBilling();
  const cases = readCases();
  const month = new Date().toISOString().slice(0,7);
  const monthCases = cases.filter(c => String(c.date || '').startsWith(month)).length;
  byId('planUsage').textContent = monthCases;
  byId('planLimit').textContent = plan.monthlyLimit;
  byId('planStatus').textContent = plan.status === 'פעיל' ? 'ON' : 'OFF';
  wrap.innerHTML = `
    <div class="kv-row"><span>שם מסלול</span><strong>${escapeHtml(plan.planName)}</strong></div>
    <div class="kv-row"><span>סטטוס</span><strong>${escapeHtml(plan.status)}</strong></div>
    <div class="kv-row"><span>חיוב הבא</span><strong>${fmtDate(plan.renewalDate)}</strong></div>
    <div class="kv-row"><span>מכסה חודשית</span><strong>${escapeHtml(plan.monthlyLimit)}</strong></div>
    <div class="kv-row"><span>תיקים החודש</span><strong>${monthCases}</strong></div>`;
}

function bindFilters(){
  ['searchInput','statusFilter','typeFilter'].forEach(id => {
    const el = byId(id);
    if(!el) return;
    el.addEventListener('input', renderDashboard);
    el.addEventListener('change', renderDashboard);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderDashboard();
  renderCase();
  renderSettings();
  renderBilling();
  bindFilters();
});
