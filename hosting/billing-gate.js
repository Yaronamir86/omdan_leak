/**
 * OMDA BILLING GATE — v2.0 — OMDA איתור נזילות
 */
const BillingGate = {
  productId: 'omdan-leak', token: null, access: null,
  async init(productId) {
    this.productId = productId || 'omdan-leak';
    return new Promise((resolve) => {
      firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = '/index.html'; return; }
        this.token = await BillingCore.getToken(user.uid);
        if (!this.token) this.token = await BillingCore.createTrialToken(user.uid, user.email);
        this.access = BillingCore.checkAccess(this.token, productId);
        if (!this.access.ok) { this._showBlocker(this.access.reason); return; }
        if (this.access.plan === 'trial') this._injectTrialBanner(this.access.daysLeft);
        resolve({ user, token: this.token, access: this.access });
      });
    });
  },
  _injectTrialBanner(daysLeft) {
    if (document.getElementById('omda-trial-banner')) return;
    const color = daysLeft <= 3 ? '#ef4444' : daysLeft <= 7 ? '#f59e0b' : '#10b981';
    const urgency = daysLeft <= 3 ? '⚠️' : daysLeft <= 7 ? '🔔' : '🎁';
    const b = document.createElement('div');
    b.id = 'omda-trial-banner';
    b.style.cssText = `position:fixed;bottom:0;left:0;right:0;z-index:9999;background:${color};color:#fff;padding:10px 20px;text-align:center;font-family:'Heebo',sans-serif;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:12px;direction:rtl;`;
    b.innerHTML = `<span>${urgency} נותרו <strong>${daysLeft} ימים</strong> בתקופת הניסיון</span><a href="/pricing.html" style="background:#fff;color:${color};border-radius:8px;padding:5px 16px;font-weight:800;text-decoration:none;font-size:13px;">שדרג עכשיו</a><button onclick="document.getElementById('omda-trial-banner').remove()" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;">×</button>`;
    document.body.appendChild(b);
    document.body.style.paddingBottom = '46px';
  },
  _showBlocker(reason) {
    const msgs = {
      trial_expired:{ title:'תקופת הניסיון הסתיימה', sub:'שדרג למסלול פעיל כדי להמשיך.' },
      subscription_expired:{ title:'המנוי הסתיים', sub:'חדש את המנוי שלך כדי לחזור לשימוש מלא.' },
      no_product:{ title:'אין גישה למוצר זה', sub:'המסלול שלך אינו כולל גישה ל-OMDA איתור.' },
      no_token:{ title:'לא נמצא חשבון מנוי', sub:'אנא הירשם כדי להתחיל.' },
    };
    const m = msgs[reason]||msgs.no_token;
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#030712;font-family:'Heebo',sans-serif;direction:rtl;"><div style="text-align:center;padding:40px;max-width:440px;"><div style="font-size:56px;margin-bottom:20px;">🔒</div><h1 style="font-size:24px;font-weight:900;color:#f9fafb;margin-bottom:10px;">${m.title}</h1><p style="color:#9ca3af;font-size:16px;margin-bottom:32px;line-height:1.6;">${m.sub}</p><a href="/pricing.html" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border-radius:12px;padding:14px 36px;font-size:16px;font-weight:800;text-decoration:none;">בחר מסלול →</a><br><br><a href="/index.html" style="color:#6b7280;font-size:13px;">חזור לכניסה</a></div></div>`;
  },
  canCreateReport() { return true; },
};
