
const STORAGE_KEY = "omda_itur_cases_v1";
const SETTINGS_KEY = "omda_itur_settings_v1";

const defaultCases = [
  {
    id: "ITR-260401-018",
    title: "איתור נזילה בדירת מגורים - רחוב החורשה 18 חיפה",
    type: "דירת מגורים",
    issue: "רטיבות בקיר סלון",
    status: "בבדיקה",
    statusClass: "active",
    priority: "גבוהה",
    date: "2026-04-01",
    customer: "משפחת כהן",
    city: "חיפה",
    area: "סלון / חזית דרומית",
    source: "הפניית עו\"ד",
    cause: "כשל בצנרת מים חמים בקיר פנימי",
    certainty: "גבוהה",
    recommendation: "פתיחת קיר נקודתית ובדיקת אינסטלטור לתיקון קו מים חמים."
  },
  {
    id: "ITR-260329-011",
    title: "איתור חדירת מים בגג משותף - רחוב דרך הים 42",
    type: "בניין משותף",
    issue: "חדירת מי גשם",
    status: "ממתין למסמכים",
    statusClass: "waiting",
    priority: "בינונית",
    date: "2026-03-29",
    customer: "ועד הבית דרך הים 42",
    city: "חיפה",
    area: "גג / חדר מדרגות קומה 4",
    source: "פנייה ישירה",
    cause: "כשל באיטום מפגש קיר-גג וסדיקה בהלבנה",
    certainty: "בינונית",
    recommendation: "השלמת דוח איטום קודם ותמונות מזמן גשם לצורך חידוד מקור החדירה."
  },
  {
    id: "ITR-260322-007",
    title: "בדיקת רטיבות בחנות מסחרית - שדרות מוריה 88",
    type: "מסחר",
    issue: "התנפחות פרקט",
    status: "הושלם",
    statusClass: "done",
    priority: "גבוהה",
    date: "2026-03-22",
    customer: "מאפיית הרים",
    city: "חיפה",
    area: "חלל מכירה אחורי",
    source: "חברת ביטוח",
    cause: "דליפה איטית מקו ניקוז מזגן בתוך קיר גבס",
    certainty: "גבוהה",
    recommendation: "החלפת קו ניקוז, ייבוש מבוקר, החלפת קטע גבס ופרקט שנפגע."
  },
  {
    id: "ITR-260320-004",
    title: "בדיקת נזילה בבית פרטי - רחוב האלון 7 נשר",
    type: "בית פרטי",
    issue: "צריכת מים חריגה",
    status: "טיוטה",
    statusClass: "draft",
    priority: "נמוכה",
    date: "2026-03-20",
    customer: "משפחת לוי",
    city: "נשר",
    area: "חצר אחורית",
    source: "פנייה ישירה",
    cause: "חשד לדליפה בצינור השקיה תת-קרקעי",
    certainty: "נמוכה",
    recommendation: "ביצוע בידוד קווים ובדיקת לחץ משלימה."
  }
];

const defaultSettings = {
  fullNameHe: "ירון אמיר",
  fullNameEn: "Yaron Amir",
  title: "מאתר נזילות מוסמך",
  license: "IL-LEAK-20418",
  city: "חיפה",
  address: "שדרות ההסתדרות 100, חיפה",
  phone: "050-1234567",
  email: "office@omda-itur.co.il",
  website: "www.omda-itur.co.il",
  linkedin: "linkedin.com/company/omda-itur",
  social: "@omda.itur",
  defaultCity: "חיפה",
  defaultPropertyType: "דירת מגורים",
  defaultSource: "פנייה ישירה",
  reportTheme: "זהב כהה"
};

function readCases(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultCases));
    return [...defaultCases];
  }
  try{return JSON.parse(raw)}catch(e){return [...defaultCases]}
}
function saveCases(cases){ localStorage.setItem(STORAGE_KEY, JSON.stringify(cases)); }
function readSettings(){
  const raw = localStorage.getItem(SETTINGS_KEY);
  if(!raw){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaultSettings));
    return {...defaultSettings};
  }
  try{return JSON.parse(raw)}catch(e){return {...defaultSettings}}
}
function saveSettings(settings){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

function fmtDate(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function renderDashboard(){
  const table = document.getElementById('cases-table-body');
  if(!table) return;
  const q = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
  const status = document.getElementById('statusFilter')?.value || '';
  const type = document.getElementById('typeFilter')?.value || '';
  const cases = readCases().sort((a,b)=>b.date.localeCompare(a.date));
  const filtered = cases.filter(c => {
    const matchesQ = !q || [c.id,c.title,c.customer,c.issue,c.city].join(' ').toLowerCase().includes(q);
    const matchesS = !status || c.status === status;
    const matchesT = !type || c.type === type;
    return matchesQ && matchesS && matchesT;
  });
  document.getElementById('kpiTotal').textContent = cases.length;
  document.getElementById('kpiActive').textContent = cases.filter(c=>["בבדיקה","נקבעה בדיקה"].includes(c.status)).length;
  document.getElementById('kpiDone').textContent = cases.filter(c=>c.status==="הושלם").length;
  document.getElementById('kpiWaiting').textContent = cases.filter(c=>c.status==="ממתין למסמכים").length;
  const month = new Date().toISOString().slice(0,7);
  document.getElementById('kpiMonth').textContent = cases.filter(c=>c.date.startsWith(month)).length;
  table.innerHTML = filtered.map(c=>`
    <tr>
      <td><strong>${c.id}</strong></td>
      <td>
        <strong>${c.title}</strong>
        <div style="color:#91a0b5;font-size:13px;margin-top:6px">${c.customer}</div>
      </td>
      <td>${c.type}</td>
      <td>${c.issue}</td>
      <td><span class="badge ${c.statusClass}">${c.status}</span></td>
      <td>${fmtDate(c.date)}</td>
      <td><a class="btn ghost" href="./case.html?id=${encodeURIComponent(c.id)}">פתח</a></td>
    </tr>
  `).join('');
  const list = document.getElementById('recentCases');
  if(list){
    list.innerHTML = cases.slice(0,4).map(c=>`
      <div class="mini-item">
        <div>
          <strong>${c.customer}</strong>
          <small>${c.issue} · ${c.area}</small>
        </div>
        <span class="badge ${c.statusClass}">${c.status}</span>
      </div>
    `).join('');
  }
}

function getCurrentCase(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const cases = readCases();
  return cases.find(c=>c.id === id) || null;
}

function renderCase(){
  const form = document.getElementById('caseForm');
  if(!form) return;
  const current = getCurrentCase();
  const settings = readSettings();
  const values = current || {
    id: `ITR-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${String(readCases().length+1).padStart(3,'0')}`,
    title: "",
    type: settings.defaultPropertyType || "דירת מגורים",
    issue: "",
    status: "טיוטה",
    statusClass: "draft",
    priority: "בינונית",
    date: new Date().toISOString().slice(0,10),
    customer: "",
    city: settings.defaultCity || "",
    area: "",
    source: settings.defaultSource || "פנייה ישירה",
    cause: "",
    certainty: "בינונית",
    recommendation: "",
    contact: "",
    phone: "",
    address: "",
    inspector: settings.fullNameHe,
    urgency: "רגילה",
    pipeType: "לא ידוע",
    moisture: "",
    thermal: "",
    pressure: "",
    acoustic: "",
    gas: "",
    damage: "",
    nextStep: "",
    summary: ""
  };
  Object.entries(values).forEach(([k,v])=>{
    const el = form.querySelector(`[name="${k}"]`);
    if(el) el.value = v ?? "";
  });
  const title = document.getElementById('casePageTitle');
  if(title) title.textContent = current ? "ניהול תיק איתור" : "פתיחת תיק איתור חדש";
  const sub = document.getElementById('casePageSub');
  if(sub) sub.textContent = current ? values.title : "יצירת תיק חדש במבנה זהה ל-OMDA רכוש, מותאם מקצועית למאתר.";
  const report = document.getElementById('reportPreview');
  if(report){
    report.innerHTML = `
      <div class="report-block">
        <strong>כותרת דוח</strong>
        <div style="margin-top:8px;color:#c6d0de">${values.title || "דוח איתור נזילות מקצועי"}</div>
      </div>
      <div class="report-block">
        <strong>מסקנה מקצועית</strong>
        <div style="margin-top:8px;color:#c6d0de">${values.cause || "המקור המשוער יעודכן לאחר מילוי כל פרטי הבדיקה."}</div>
      </div>
      <div class="report-block">
        <strong>המלצה אופרטיבית</strong>
        <div style="margin-top:8px;color:#c6d0de">${values.recommendation || "ההמלצה תתעדכן אוטומטית לאחר השלמת התיק."}</div>
      </div>
    `;
  }
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.title = data.title || `איתור נזילה - ${data.address || data.city || data.customer}`;
    const statusMap = {
      "טיוטה":"draft",
      "נקבעה בדיקה":"active",
      "בבדיקה":"active",
      "ממתין למסמכים":"waiting",
      "דוח בהכנה":"waiting",
      "הושלם":"done"
    };
    data.statusClass = statusMap[data.status] || "draft";
    const cases = readCases();
    const idx = cases.findIndex(c=>c.id === data.id);
    if(idx >= 0) cases[idx] = {...cases[idx], ...data};
    else cases.unshift(data);
    saveCases(cases);
    location.href = "./dashboard.html";
  });
}

function renderSettings(){
  const form = document.getElementById('settingsForm');
  if(!form) return;
  const settings = readSettings();
  Object.entries(settings).forEach(([k,v])=>{
    const el = form.querySelector(`[name="${k}"]`);
    if(el) el.value = v ?? "";
  });
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    saveSettings(Object.fromEntries(new FormData(form).entries()));
    const status = document.getElementById('saveStatus');
    if(status){
      status.textContent = "נשמר בהצלחה";
      setTimeout(()=>status.textContent = "", 2400);
    }
  });
}

function renderBilling(){
  const root = document.getElementById('billingData');
  if(!root) return;
  const cases = readCases();
  const plan = {
    name:"Professional איתור",
    status:"פעיל",
    renewal:"01.05.2026",
    amount:"249 ₪ / חודש",
    reports: cases.length,
    storage:"3.2GB",
    users:"1 משתמש פעיל"
  };
  root.innerHTML = `
    <div class="metric"><span>מסלול</span><strong>${plan.name}</strong></div>
    <div class="metric"><span>סטטוס מנוי</span><strong style="color:#acf1cd">${plan.status}</strong></div>
    <div class="metric"><span>חיוב הבא</span><strong>${plan.renewal}</strong></div>
    <div class="metric"><span>עלות</span><strong>${plan.amount}</strong></div>
    <div class="metric"><span>תיקים במערכת</span><strong>${plan.reports}</strong></div>
    <div class="metric"><span>אחסון</span><strong>${plan.storage}</strong></div>
    <div class="metric"><span>משתמשים</span><strong>${plan.users}</strong></div>
  `;
}

function bindDashboardControls(){
  ['searchInput','statusFilter','typeFilter'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', renderDashboard);
    if(el) el.addEventListener('change', renderDashboard);
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  renderDashboard();
  renderCase();
  renderSettings();
  renderBilling();
  bindDashboardControls();
});
