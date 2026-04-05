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
  trial: { monthly: 0, annual: 0, name: "OMDA איתור ניסיון", product: "omdan-leak" },
  leak:  { monthly: 29, annual: 290, name: "OMDA איתור", product: "omdan-leak" },
  "bundle-starter-leak": {
    monthly: 109, annual: 890,
    name: "Bundle — רכוש Starter + איתור",
    product: "bundle",
    includes: { "omdan-property": "starter", "omdan-leak": "leak" },
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

      const { planId = "leak", billingMode = "monthly" } = req.body;
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

      // Build Cardcom LowProfile request
      const params = {
        TerminalNumber: terminal,
        UserName: username,
        AutoReturn: 1,
        ReturnValue: sessionRef.id,
        Operation: 1,
        NumOfPayments: 1,
        Amount: amount,
        CoinID: 1,
        Language: "HE",
        ProductName: plan.name,
        SuccessRedirectUrl: CARDCOM_URLS.successUrl + `?session=${sessionRef.id}`,
        FailedRedirectUrl: CARDCOM_URLS.errorUrl + `?session=${sessionRef.id}`,
        WebHookUrl: CARDCOM_URLS.webhookUrl,
        CreateInvoice: 1,
        InvoiceHead: { CustName: decoded.name || decoded.email },
      };

      const qs = querystring.stringify(params);
      const cardcomResp = await new Promise((resolve, reject) => {
        const options = {
          hostname: "secure.cardcom.solutions",
          path: "/Interface/LowProfile.aspx?" + qs,
          method: "GET",
        };
        https.get(options, (r) => {
          let data = "";
          r.on("data", (c) => (data += c));
          r.on("end", () => resolve(data));
        }).on("error", reject);
      });

      // Parse response
      const urlMatch = cardcomResp.match(/url=([^&]+)/i);
      if (!urlMatch) { throw new Error("Cardcom: no redirect URL in response"); }
      const url = decodeURIComponent(urlMatch[1]);

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
      const { ReturnValue: sessionId, Operation, ResponseCode } = req.body;
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

        if (planId.startsWith("bundle-")) {
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
