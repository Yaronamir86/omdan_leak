/**
 * ═══════════════════════════════════════════════════════
 *  OMDA BILLING CORE — v2.0
 *  מערכת חיוב מרכזית — OMDA איתור נזילות
 * ═══════════════════════════════════════════════════════
 */

const BILLING_PLANS = {
  trial: { id:'trial', product:'omdan-leak', label:'ניסיון חינם', priceMonthly:0, priceAnnual:0 },
  leak:  { id:'leak',  product:'omdan-leak', label:'OMDA איתור',  priceMonthly:29, priceAnnual:290 },
  'bundle-starter-leak': {
    id: 'bundle-starter-leak',
    product: 'bundle',
    label: 'Bundle — רכוש Starter + איתור',
    priceMonthly: 109,
    priceAnnual:  890,
    fullPriceMonthly: 118,
    includes: ['omdan-property:starter', 'omdan-leak:leak'],
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
    trialEnd.setDate(trialEnd.getDate() + 14);
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

    if (token.plan === 'trial') {
      const trialEnd = toDate(token.trialEnd);
      if (!trialEnd || now > trialEnd) return { ok: false, reason: 'trial_expired' };
      const daysLeft = Math.ceil((trialEnd-now)/86400000);
      return { ok: true, plan: 'trial', daysLeft };
    }

    if (token.plan === 'leak' && token.status === 'active') {
      const subEnd = toDate(token.subscriptionEnd);
      if (!subEnd || now > subEnd) return { ok: false, reason: 'subscription_expired' };
      return { ok: true, plan: token.plan };
    }

    return { ok: false, reason: 'unknown' };
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
