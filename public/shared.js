
const LS={reports:'amirLeak.reports.v2',customers:'amirLeak.customers.v2',settings:'amirLeak.settings.v2',billing:'amirLeak.billing.v2',users:'amirLeak.users.v2',session:'amirLeak.session.v2',activity:'amirLeak.activity.v2'};
const DEFAULT_SETTINGS={companyName:'אמיר — מאתר נזקי צנרת',companySubtitle:'מערכת דיווח וניהול דוחות',inspectorDefault:'אמיר',disclaimer:'הדוח הופק באמצעות מערכת טכנולוגית בלבד. האחריות המקצועית, העובדתית והמשפטית על תוכן הדוח, התמונות, נתוני הבדיקות והמסקנות הינה של עורך הדוח בלבד.'};
const DEFAULT_BILLING={plan:'trial',status:'trial',cycle:'monthly',reportsThisMonth:0,reportsLimit:5,trialEnd:addDaysISO(new Date(),14),cancelAtEnd:false};
function addDaysISO(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return d.toISOString();}
function readLS(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(e){return fallback}}
function writeLS(key,value){localStorage.setItem(key,JSON.stringify(value));return value}
function uid(prefix='id'){return prefix+'_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function nowISO(){return new Date().toISOString()}
function fmtDate(v){if(!v)return '—';return new Date(v).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'})}
function fmtDateTime(v){if(!v)return '—';return new Date(v).toLocaleString('he-IL')}
function escapeHtml(s){return (s??'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function getSettings(){return Object.assign({},DEFAULT_SETTINGS,readLS(LS.settings,{}))}
function saveSettings(data){return writeLS(LS.settings,Object.assign({},getSettings(),data))}
function getBilling(){return Object.assign({},DEFAULT_BILLING,readLS(LS.billing,{}))}
function saveBilling(data){return writeLS(LS.billing,Object.assign({},getBilling(),data))}
function getReports(){return readLS(LS.reports,[])} function saveReports(v){return writeLS(LS.reports,v)}
function getCustomers(){return readLS(LS.customers,[])} function saveCustomers(v){return writeLS(LS.customers,v)}
function getUsers(){return readLS(LS.users,[])} function saveUsers(v){return writeLS(LS.users,v)}
function getSession(){return readLS(LS.session,null)} function saveSession(v){return writeLS(LS.session,v)}
function getActivity(){return readLS(LS.activity,[])}
function logActivity(type,message,meta={}){const items=getActivity();items.unshift({id:uid('act'),type,message,meta,at:nowISO()});writeLS(LS.activity,items.slice(0,200))}
function ensureSeed(){if(!localStorage.getItem(LS.settings))saveSettings({});if(!localStorage.getItem(LS.billing))saveBilling({});if(!localStorage.getItem(LS.users))saveUsers([{id:uid('usr'),email:'demo@amir-leak.local',password:'123456',firstName:'אמיר',lastName:'כהן',role:'owner',createdAt:nowISO()}]);if(!getSession()){const u=getUsers()[0];saveSession({userId:u.id,email:u.email,role:u.role,displayName:u.firstName+' '+u.lastName})}}
ensureSeed();
function upsertCustomerFromReport(report){const items=getCustomers();if(!(report.phone||report.clientName))return;let c=items.find(x=>(x.phone||'')===(report.phone||'') && report.phone);if(!c){c={id:uid('cus'),createdAt:nowISO()};items.unshift(c)};Object.assign(c,{clientName:report.clientName||c.clientName||'',phone:report.phone||c.phone||'',city:report.city||c.city||'',address:report.address||c.address||'',apartment:report.apartment||c.apartment||'',lastReportId:report.id,lastUpdatedAt:nowISO()});c.reportsCount=getReports().filter(r=>(r.phone||'')===(c.phone||'') && c.phone).length;saveCustomers(items)}
function statusBadge(status){const map={draft:'<span class="badge">טיוטה</span>',ready:'<span class="badge warn">מוכן לבדיקה</span>',sent:'<span class="badge ok">נשלח</span>',archived:'<span class="badge">בארכיון</span>'};return map[status]||'<span class="badge">לא ידוע</span>'}
function reportNumber(){const d=new Date();return 'LF-'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0')}
function showToast(msg){let el=document.querySelector('.toast');if(!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el)}el.textContent=msg;el.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.classList.remove('show'),2600)}
function legalFooter(relative=''){return '<div class="footer-legal"><a href="'+relative+'legal/index.html">מסמכים משפטיים</a><a href="'+relative+'legal/terms-of-service/terms-he.html">תנאי שימוש</a><a href="'+relative+'legal/privacy-policy/privacy-he.html">מדיניות פרטיות</a><a href="'+relative+'legal/refund-policy/refunds-he.html">החזרים וביטול מנוי</a><a href="'+relative+'legal/professional-disclaimer/disclaimer-he.html">הבהרה מקצועית</a></div>'}
