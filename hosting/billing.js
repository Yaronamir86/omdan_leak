/**
 * ═══════════════════════════════════════════════════════
 *  OMDA BILLING CORE — v2.2
 *  מערכת חיוב מרכזית — OMDA איתור נזילות
 *
 *  שינויים v2.2 (אפריל 2026):
 *  - ניסיון: 14 → 28 יום, עד 8 דוחות
 *  - פלאן leak שונה שם ל-starter (39₪) — נשמר גם לתאימות לאחור
 *  - פלאן pro חדש (79₪) — ללא הגבלת דוחות + יומן פגישות (בקרוב)
 *  - bundle מעודכן ל-129₪ (שניהם ללא הגבלה)
 *  - checkAccess תומך ב-starter / pro / leak (legacy)
 *  - checkReportLimit: פונקציה חדשה לבדיקת מגבלת דוחות
 * ═══════════════════════════════════════════════════════
 */

const BILLING_PLANS = {
  trial: {
    id: 'trial',
    product: 'omdan-leak',
    label: 'ניסיון חינם',
    priceMonthly: 0,
    priceAnnual: 0,
    maxReportsPerMonth: 8,       // מגבלה בתקופת ניסיון
    trialDays: 28,
  },
  free: {
    id: 'free',
    product: 'omdan-leak',
    label: 'חינמי (ידני)',
    priceMonthly: 0,
    priceAnnual: 0,
  },

  // ─── פלאן ישן (legacy) — נשמר לתאימות לאחור עם מנויים קיימים ───
  leak: {
    id: 'leak',
    product: 'omdan-leak',
    label: 'OMDA איתור (legacy)',
    priceMonthly: 29,
    priceAnnual: 290,
    _legacy: true,               // סימון פנימי — לא להציג ב-UI חדש
  },

  // ─── פלאנים חדשים ───
  starter: {
    id: 'starter',
    product: 'omdan-leak',
    label: 'OMDA איתור — Starter',
    priceMonthly: 39,
    priceAnnual: 374,            // ~20% הנחה שנתית
    maxReportsPerMonth: 20,
  },
  pro: {
    id: 'pro',
    product: 'omdan-leak',
    label: 'OMDA איתור — Pro',
    priceMonthly: 79,
    priceAnnual: 756,            // ~20% הנחה שנתית
    maxReportsPerMonth: null,    // null = ללא הגבלה
    features: ['calendar'],      // יומן פגישות — בקרוב
  },

  // ─── באנדל ───
  'bundle-starter-leak': {
    id: 'bundle-starter-leak',
    product: 'bundle',
    label: 'Bundle — רכוש Starter + איתור (legacy)',
    priceMonthly: 109,
    priceAnnual: 890,
    fullPriceMonthly: 118,
    includes: ['omdan-property:starter', 'omdan-leak:leak'],
    _legacy: true,               // סימון פנימי
  },
  bundle: {
    id: 'bundle',
    product: 'bundle',
    label: 'Bundle — רכוש + איתור ללא הגבלה',
    priceMonthly: 129,
    priceAnnual: 1238,           // ~20% הנחה שנתית
    maxReportsPerMonth: null,    // ללא הגבלה בשני המוצרים
    includes: ['omdan-property:pro', 'omdan-leak:pro'],
  },
};

const BILLING_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBZlf3YfVAYQ2f2MFrlDiGOD6mRaJcHAtg",
  authDomain: "omdan-leak.firebaseapp.com",
  projectId: "omdan-leak",
  storageBucket: "omdan-leak.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef"
};

class BillingCore {

  static async getToken(uid) {
    try {
      const doc = await firebase.firestore().collection('billing').doc(uid).get();
      if (!doc.exists) return null;
      return doc.data();
    } catch(e) {
      console.error('BillingCore.getToken:', e);
      return null;
    }
  }

  static async createTrialToken(uid, email) {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 28);   // v2.2: 28 יום (היה 14)
    const token = {
      uid, email,
      plan: 'trial',
      products: ['omdan-leak'],
      trialEnd: trialEnd.toISOString(),
      subscriptionEnd: null,
      reportsThisMonth: 0,
      reportsResetAt: new Date(new Date().getFullYear(), new Date().getMonth()+1, 1).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await firebase.firestore().collection('billing').doc(uid).set(token);
    return token;
  }

  static checkAccess(token, productId) {
    if (!token) return { ok: false, reason: 'no_token' };

    const now = new Date();
    const toDate = (v) => {
      if (!v) return null;
      if (v?.toDate) return v.toDate();
      if (v instanceof Date) return v;
      return new Date(v);
    };

    // plans-map structure
    if (token.plans && token.plans[productId]) {
      const p = token.plans[productId];

      if (p.plan === 'free') return { ok: true, plan: 'free' };

      if (p.plan === 'trial') {
        const trialEnd = toDate(p.trialEnd);
        if (!trialEnd || now > trialEnd) return { ok: false, reason: 'trial_expired' };
        return { ok: true, plan: 'trial', daysLeft: Math.ceil((trialEnd-now)/86400000) };
      }
      if (p.status === 'active') {
        const subEnd = toDate(p.subscriptionEnd);
        if (!subEnd || now > subEnd) return { ok: false, reason: 'subscription_expired' };
        return { ok: true, plan: p.plan };
      }
      return { ok: false, reason: 'subscription_expired' };
    }

    // flat legacy structure
    const hasProduct = !token.products
      || token.products.includes(productId)
      || token.products.includes('omdan-leak');

    if (!hasProduct) return { ok: false, reason: 'no_product' };

    if (token.plan === 'free') return { ok: true, plan: 'free' };

    if (token.plan === 'trial') {
      const trialEnd = toDate(token.trialEnd);
      if (!trialEnd || now > trialEnd) return { ok: false, reason: 'trial_expired' };
      const daysLeft = Math.ceil((trialEnd-now)/86400000);
      return { ok: true, plan: 'trial', daysLeft };
    }

    // v2.2: תמיכה ב-starter / pro בנוסף ל-leak (legacy)
    const paidPlans = ['leak', 'starter', 'pro', 'bundle', 'bundle-starter-leak'];
    if (paidPlans.includes(token.plan) && token.status === 'active') {
      const subEnd = toDate(token.subscriptionEnd);
      if (!subEnd || now > subEnd) return { ok: false, reason: 'subscription_expired' };
      return { ok: true, plan: token.plan };
    }

    return { ok: false, reason: 'unknown' };
  }

  /**
   * checkReportLimit — v2.2
   * בודק האם המשתמש יכול ליצור דוח נוסף לפי מגבלת הפלאן שלו.
   * מחזיר: { allowed: boolean, reason?: string, used: number, max: number|null }
   */
  static checkReportLimit(token) {
    if (!token) return { allowed: false, reason: 'no_token', used: 0, max: 0 };

    const planId = token.plan || 'trial';
    const planDef = BILLING_PLANS[planId];
    const used = token.reportsThisMonth || 0;

    // פלאנים ללא הגבלה
    if (['pro', 'bundle', 'free'].includes(planId)) {
      return { allowed: true, used, max: null };
    }

    // ניסיון — עד 8 דוחות
    if (planId === 'trial') {
      const max = (planDef && planDef.maxReportsPerMonth) || 8;
      if (used >= max) return { allowed: false, reason: 'trial_reports_exceeded', used, max };
      return { allowed: true, used, max };
    }

    // סטרטר / leak legacy — עד 20 דוחות
    if (['starter', 'leak', 'bundle-starter-leak'].includes(planId)) {
      const max = (planDef && planDef.maxReportsPerMonth) || 20;
      if (used >= max) return { allowed: false, reason: 'monthly_limit_exceeded', used, max };
      return { allowed: true, used, max };
    }

    // ברירת מחדל — מאפשר (לא חוסם תכונות לא מוכרות)
    return { allowed: true, used, max: null };
  }

  static getDaysLeftInTrial(token) {
    if (!token || token.plan !== 'trial') return null;
    const trialEnd = token.trialEnd?.toDate ? token.trialEnd.toDate() : new Date(token.trialEnd);
    return Math.max(0, Math.ceil((trialEnd-new Date())/86400000));
  }

  static getPlanDetails(planId) {
    return BILLING_PLANS[planId] || null;
  }
}

if (typeof module !== 'undefined') module.exports = { BillingCore, BILLING_PLANS };
