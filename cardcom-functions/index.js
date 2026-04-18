/**
 * OMDA Leak Detection — Firebase Cloud Functions
 * ================================================
 * Billing (Cardcom):
 *   POST /cardcomCreatePayment
 *   POST /cardcomWebhook
 *   cardcomRenewSubscriptions (Scheduled)
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const https = require("https");
const querystring = require("querystring");
 
admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
 
// ── Secrets ──────────────────────────────────────────────
const CARDCOM_TERMINAL = defineSecret("CARDCOM_TERMINAL");
const CARDCOM_USERNAME = defineSecret("CARDCOM_USERNAME");
 
// ── Plans ─────────────────────────────────────────────────
const PLANS = {
  // ─── פלאנים פעילים ───
  trial: {
    monthly: 0, annual: 0,
    name: "OMDA איתור ניסיון",
    product: "omdan-leak",
    trialDays: 28,
    maxReportsPerMonth: 8,
  },
  starter: {
    monthly: 39, annual: 374,
    name: "OMDA איתור — Starter",
    product: "omdan-leak",
    maxReportsPerMonth: 20,
  },
  pro: {
    monthly: 79, annual: 756,
    name: "OMDA איתור — Pro",
    product: "omdan-leak",
    maxReportsPerMonth: null,
  },
  bundle: {
    monthly: 129, annual: 1238,
    name: "Bundle — רכוש + איתור ללא הגבלה",
    product: "bundle",
    maxReportsPerMonth: null,
    includes: { "omdan-property": "pro", "omdan-leak": "pro" },
  },
  // ─── legacy ───
  leak: {
    monthly: 29, annual: 290,
    name: "OMDA איתור (legacy)",
    product: "omdan-leak",
    maxReportsPerMonth: 20,
    _legacy: true,
  },
  "bundle-starter-leak": {
    monthly: 109, annual: 890,
    name: "Bundle — רכוש Starter + איתור (legacy)",
    product: "bundle",
    includes: { "omdan-property": "starter", "omdan-leak": "leak" },
    _legacy: true,
  },
};
 
const CARDCOM_URLS = {
  lowProfile: "https://secure.cardcom.solutions/Interface/LowProfile.aspx",
  indicator: "https://secure.cardcom.solutions/Interface/BillGoldGetLowProfileIndicator.aspx",
  chargeToken: "https://secure.cardcom.solutions/Interface/BillGoldService.asmx",
  successUrl: "https://omdan-leak.web.app/billing-success.html",
  errorUrl: "https://omdan-leak.web.app/billing-error.html",
  webhookUrl: "https://us-central1-omdan-leak.cloudfunctions.net/cardcomWebhook",
};
 
// ── CORS helper ───────────────────────────────────────────
function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
 
async function verifyToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    return await admin.auth().verifyIdToken(auth.replace("Bearer ", ""));
  } catch {
    return null;
  }
}
 
// ── Case number generator ──────────────────────────────────
async function nextCaseNumber() {
  const counterRef = db.collection("counters").doc("leakCases");
  const num = await db.runTransaction(async (t) => {
    const snap = await t.get(counterRef);
    const next = (snap.exists ? snap.data().value : 0) + 1;
    t.set(counterRef, { value: next });
    return next;
  });
  const year = new Date().getFullYear().toString().slice(-2);
  return `IL-${year}-${String(num).padStart(4, "0")}`;
}
 
// ════════════════════════════════════════════════════════════
//  cardcomCreatePayment  POST /cardcomCreatePayment
// ════════════════════════════════════════════════════════════
exports.cardcomCreatePayment = onRequest(
  { region: "us-central1", secrets: [CARDCOM_TERMINAL, CARDCOM_USERNAME] },
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
 
    try {
      const decoded = await verifyToken(req);
      if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return; }
 
      const { planId = "starter", billingMode = "monthly" } = req.body;
      const plan = PLANS[planId];
      if (!plan) { res.status(400).json({ error: "Invalid plan" }); return; }
 
      const amount = billingMode === "annual" ? plan.annual : plan.monthly;
      const terminal = CARDCOM_TERMINAL.value();
      const username = CARDCOM_USERNAME.value();
 
      // Create checkout session in Firestore
      const sessionRef = db.collection("checkoutSessions").doc();
      const sessionData = {
        uid: decoded.uid,
        email: decoded.email,
        planId,
        billingMode,
        amount,
        product: "omdan-leak",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      };
      await sessionRef.set(sessionData);
 
      // Build Cardcom LowProfile request — POST עם UTF-8
      const params = {
        TerminalNumber: terminal,
        UserName: username,
        APILevel: "10",
        Operation: "2",
        CoinId: "1",
        Language: "he",
        Codepage: "65001",
        SumToBill: String(amount),
        ProductName: plan.name,
        CardOwnerEmail: decoded.email || "",
        SuccessRedirectUrl: CARDCOM_URLS.successUrl + `?session=${sessionRef.id}`,
        ErrorRedirectUrl: CARDCOM_URLS.errorUrl + `?session=${sessionRef.id}`,
        IndicatorUrl: CARDCOM_URLS.webhookUrl,
        ReturnValue: sessionRef.id,
        InvoiceHeadOperation: "1",
        DocTypeToCreate: "400",
        AutoRedirect: "false",
        "InvoiceHead.CustName": decoded.name || decoded.email || "לקוח OMDA",
        "InvoiceHead.Email": decoded.email || "",
        "InvoiceHead.SendByEmail": "true",
        "InvoiceHead.Language": "he",
        "InvoiceHead.Comments": `${plan.name} - ${billingMode}`,
        "InvoiceLines.Description": plan.name,
        "InvoiceLines.Quantity": "1",
        "InvoiceLines.Price": String(amount),
        "InvoiceLines.IsPriceIncludeVAT": "true",
      };

      const cardcomResp = await new Promise((resolve, reject) => {
        const body = querystring.stringify(params);
        const u = new URL(CARDCOM_URLS.lowProfile);
        const req2 = https.request(
          {
            hostname: u.hostname,
            path: u.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (r) => {
            let data = "";
            r.on("data", (c) => (data += c));
            r.on("end", () => resolve(data));
          }
        );
        req2.on("error", reject);
        req2.write(body);
        req2.end();
      });

      // Parse response
      const parsed = {};
      cardcomResp.split("&").forEach(pair => {
        const [k, v] = pair.split("=");
        if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v || "");
      });
      const url = parsed.url || parsed.Url || parsed.LowProfileUrl || null;
      if (!url) {
        logger.error("Cardcom response:", cardcomResp);
        throw new Error("Cardcom: no redirect URL in response");
      }
 
      res.json({ url, sessionId: sessionRef.id });
    } catch (e) {
      logger.error("cardcomCreatePayment error:", e);
      res.status(500).json({ error: e.message });
    }
  }
);
 
// ════════════════════════════════════════════════════════════
//  cardcomWebhook  POST /cardcomWebhook
// ════════════════════════════════════════════════════════════
exports.cardcomWebhook = onRequest(
  { region: "us-central1", secrets: [CARDCOM_TERMINAL, CARDCOM_USERNAME] },
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
 
    try {
      const source = Object.keys(req.body || {}).length ? req.body : req.query;
      const sessionId = source.ReturnValue;
      const ResponseCode = source.ResponseCode || source.DealResponse || source.OperationResponse || "1";
      if (!sessionId) { res.status(400).send("Missing session"); return; }
 
      const sessionRef = db.collection("checkoutSessions").doc(sessionId);
 
      await db.runTransaction(async (t) => {
        const snap = await t.get(sessionRef);
        if (!snap.exists) throw new Error("Session not found");
        const session = snap.data();
 
        // Idempotency
        if (session.status === "completed") return;
 
        if (ResponseCode !== "0") {
          t.update(sessionRef, { status: "failed", updatedAt: FieldValue.serverTimestamp() });
          return;
        }
 
        const uid = session.uid;
        const planId = session.planId;
        const billingMode = session.billingMode;
        const amount = session.amount;
 
        // Calculate subscription period
        const now = new Date();
        const subEnd = new Date(now);
        if (billingMode === "annual") {
          subEnd.setFullYear(subEnd.getFullYear() + 1);
        } else {
          subEnd.setMonth(subEnd.getMonth() + 1);
        }
 
        const billingRef = db.collection("billing").doc(uid);
 
        if (planId === "bundle" || planId.startsWith("bundle-")) {
          // Bundle — update both products
          const bundle = PLANS[planId];
          const updates = {};
          Object.entries(bundle.includes || {}).forEach(([productId, plan]) => {
            updates[`plans.${productId}`] = {
              plan, status: "active",
              subscriptionEnd: subEnd,
              billingMode,
            };
          });
          t.set(billingRef, {
            uid, email: session.email,
            plan: planId,
            status: "active",
            subscriptionEnd: subEnd,
            billingMode,
            lastPaymentAmount: amount,
            lastPaymentAt: now,
            ...updates,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          t.set(billingRef, {
            uid, email: session.email,
            plan: planId,
            products: ["omdan-leak"],
            status: "active",
            subscriptionEnd: subEnd,
            subscriptionStart: now,
            billingMode,
            lastPaymentAmount: amount,
            lastPaymentAt: now,
            cancelAtEnd: false,
            reportsThisMonth: 0,
            reportsResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            [`plans.omdan-leak`]: {
              plan: planId,
              status: "active",
              subscriptionEnd: subEnd,
              billingMode,
            },
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
 
        // Record payment
        const paymentRef = db.collection("payments").doc();
        t.set(paymentRef, {
          uid,
          sessionId,
          planId,
          billingMode,
          amount,
          product: "omdan-leak",
          processedAt: now,
          type: "purchase",
        });
 
        t.update(sessionRef, {
          status: "completed",
          processedAt: FieldValue.serverTimestamp(),
        });
      });
 
      res.status(200).send("OK");
    } catch (e) {
      logger.error("cardcomWebhook error:", e);
      res.status(500).send("Error");
    }
  }
);
 
// ════════════════════════════════════════════════════════════
//  cardcomRenewSubscriptions  Scheduled daily
// ════════════════════════════════════════════════════════════
exports.cardcomRenewSubscriptions = onSchedule(
  { schedule: "every 24 hours", region: "us-central1", secrets: [CARDCOM_TERMINAL, CARDCOM_USERNAME] },
  async () => {
    logger.info("Renewal check for omda-leak");
    // Implementation mirrors property — charge token if not cancelAtEnd and subEnd within 2 days
    // Skipping full implementation here — add when Cardcom credentials are in Secret Manager
  }
);
 
// ── Health check ──────────────────────────────────────────
exports.health = onRequest({ region: "us-central1" }, (req, res) => {
  res.json({ ok: true, service: "omda-leak-functions", ts: Date.now() });
});