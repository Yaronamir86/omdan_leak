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
const { FieldValue } = require("firebase-admin/firestore");
const https = require("https");
const querystring = require("querystring");

const db = admin.firestore();

// ── Secrets ──────────────────────────────────────────────
const CARDCOM_TERMINAL = defineSecret("CARDCOM_TERMINAL");
const CARDCOM_USERNAME = defineSecret("CARDCOM_USERNAME");

// ── Plans ─────────────────────────────────────────────────
const PLANS = {
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

async function getCardcomIndicator(lowProfileCode) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({
      TerminalNumber: CARDCOM_TERMINAL.value(),
      UserName: CARDCOM_USERNAME.value(),
      LowProfileCode: String(lowProfileCode || ""),
    });

    const u = new URL(CARDCOM_URLS.indicator);
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
        r.on("end", () => {
          const parsed = {};
          String(data || "").split("&").forEach((pair) => {
            const idx = pair.indexOf("=");
            if (idx === -1) return;
            const k = pair.slice(0, idx);
            const v = pair.slice(idx + 1);
            if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v || "");
          });
          resolve({ raw: data, parsed });
        });
      }
    );

    req2.on("error", reject);
    req2.write(body);
    req2.end();
  });
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

      const params = {
        TerminalNumber: terminal,
        UserName: username,
        CreateToken: "true",
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
        AutoRedirect: "false",
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

      const parsed = {};
      cardcomResp.split("&").forEach((pair) => {
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
      logger.info("BODY=" + JSON.stringify(req.body || {}));
      logger.info("QUERY=" + JSON.stringify(req.query || {}));

      const sessionId = source.ReturnValue;
      const ResponseCode = source.ResponseCode || source.DealResponse || source.OperationResponse || "1";
      const lowProfileCode = source.lowprofilecode || source.LowProfileCode || null;

      if (!sessionId) { res.status(400).send("Missing session"); return; }

      const sessionRef = db.collection("checkoutSessions").doc(sessionId);

      await db.runTransaction(async (t) => {
        const snap = await t.get(sessionRef);
        if (!snap.exists) throw new Error("Session not found");
        const session = snap.data();

        if (session.status === "completed") return;

        if (ResponseCode !== "0") {
          t.update(sessionRef, { status: "failed", updatedAt: FieldValue.serverTimestamp() });
          return;
        }

        const uid = session.uid;
        const planId = session.planId;
        const billingMode = session.billingMode;
        const amount = session.amount;

        let cardcomToken = source.Token || source.TokenNumber || source.CardToken || null;
        let indicatorParsed = {};

        if (!cardcomToken && lowProfileCode) {
          try {
            const indicator = await getCardcomIndicator(lowProfileCode);
            indicatorParsed = indicator.parsed || {};

            const indicatorToken =
              indicatorParsed.Token ||
              indicatorParsed.TokenNumber ||
              indicatorParsed.CardToken ||
              indicatorParsed.TokenToCharge ||
              null;

            if (indicatorToken) {
              cardcomToken = indicatorToken;
            }

            logger.info("Cardcom indicator checked", {
              lowProfileCode,
              hasToken: !!indicatorToken,
              parsedKeys: Object.keys(indicatorParsed || {}),
            });
          } catch (err) {
            logger.error("Cardcom indicator request failed", {
              lowProfileCode,
              error: err.message,
            });
          }
        }

        const now = new Date();
        const subEnd = new Date(now);
        if (billingMode === "annual") {
          subEnd.setFullYear(subEnd.getFullYear() + 1);
        } else {
          subEnd.setMonth(subEnd.getMonth() + 1);
        }

        const billingRef = db.collection("billing").doc(uid);
        const billingSnap = await t.get(billingRef);
        const existingBilling = billingSnap.exists ? billingSnap.data() : {};
        const existingToken = existingBilling.cardcomToken || null;

        if (planId === "bundle" || planId.startsWith("bundle-")) {
          const bundle = PLANS[planId];
          const updates = {};
          Object.entries(bundle.includes || {}).forEach(([productId, plan]) => {
            updates[`plans.${productId}`] = {
              plan,
              status: "active",
              subscriptionEnd: subEnd,
              billingMode,
            };
          });

          const billingData = {
            uid,
            email: session.email,
            plan: planId,
            status: "active",
            subscriptionEnd: subEnd,
            billingMode,
            lastPaymentAmount: amount,
            lastPaymentAt: now,
            ...updates,
            updatedAt: FieldValue.serverTimestamp(),
          };

          if (!existingToken && cardcomToken) {
            billingData.cardcomToken = cardcomToken;
            billingData.cardcomLowProfileCode = lowProfileCode || null;
            billingData.cardcomTokenUpdatedAt = FieldValue.serverTimestamp();
          }

          if (indicatorParsed && Object.keys(indicatorParsed).length) {
            billingData.cardValidityMonth =
              indicatorParsed.CardValidityMonth ||
              indicatorParsed.cardValidityMonth ||
              existingBilling.cardValidityMonth ||
              null;

            billingData.cardValidityYear =
              indicatorParsed.CardValidityYear ||
              indicatorParsed.cardValidityYear ||
              existingBilling.cardValidityYear ||
              null;
          }

          t.set(billingRef, billingData, { merge: true });
        } else {
          const billingData = {
            uid,
            email: session.email,
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
          };

          if (!existingToken && cardcomToken) {
            billingData.cardcomToken = cardcomToken;
            billingData.cardcomLowProfileCode = lowProfileCode || null;
            billingData.cardcomTokenUpdatedAt = FieldValue.serverTimestamp();
          }

          if (indicatorParsed && Object.keys(indicatorParsed).length) {
            billingData.cardValidityMonth =
              indicatorParsed.CardValidityMonth ||
              indicatorParsed.cardValidityMonth ||
              existingBilling.cardValidityMonth ||
              null;

            billingData.cardValidityYear =
              indicatorParsed.CardValidityYear ||
              indicatorParsed.cardValidityYear ||
              existingBilling.cardValidityYear ||
              null;
          }

          t.set(billingRef, billingData, { merge: true });
        }

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

async function chargeCardcomToken({
  token,
  amount,
  cardValidityMonth,
  cardValidityYear,
}) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({
      TerminalNumber: CARDCOM_TERMINAL.value(),
      UserName: CARDCOM_USERNAME.value(),
      CodePage: "65001",
      "TokenToCharge.Token": String(token || ""),
      "TokenToCharge.CardValidityMonth": String(cardValidityMonth || ""),
      "TokenToCharge.CardValidityYear": String(cardValidityYear || ""),
      "TokenToCharge.SumToBill": String(amount || ""),
      "TokenToCharge.CoinID": "1",
      "TokenToCharge.APILevel": "10",
    });

    const req2 = https.request(
      {
        hostname: "secure.cardcom.solutions",
        path: "/Interface/ChargeToken.aspx",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const parsed = {};
          String(data || "").split("&").forEach((pair) => {
            const idx = pair.indexOf("=");
            if (idx === -1) return;
            const k = pair.slice(0, idx);
            const v = pair.slice(idx + 1);
            if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v || "");
          });
          resolve({
            ok: (parsed.ResponseCode || "") === "0",
            raw: data,
            parsed,
          });
        });
      }
    );

    req2.on("error", reject);
    req2.write(body);
    req2.end();
  });
}

// ════════════════════════════════════════════════════════════
//  cardcomRenewSubscriptions  Scheduled daily
// ════════════════════════════════════════════════════════════
exports.cardcomRenewSubscriptions = onSchedule(
  {
    schedule: "every 24 hours",
    region: "us-central1",
    secrets: [CARDCOM_TERMINAL, CARDCOM_USERNAME],
  },
  async () => {
    logger.info("Renewal check started for omdan-leak");

    const now = new Date();
    const renewUntil = new Date(now);
    renewUntil.setDate(renewUntil.getDate() + 2);

    const snap = await db
      .collection("billing")
      .where("status", "==", "active")
      .where("cancelAtEnd", "==", false)
      .get();

    logger.info("Renewal candidates fetched", { count: snap.size });

    for (const doc of snap.docs) {
      const billing = doc.data();
      const uid = doc.id;

      try {
        const token = billing.cardcomToken || null;
        const subEnd = billing.subscriptionEnd?.toDate
          ? billing.subscriptionEnd.toDate()
          : billing.subscriptionEnd instanceof Date
          ? billing.subscriptionEnd
          : billing.subscriptionEnd
          ? new Date(billing.subscriptionEnd)
          : null;

        if (!token) {
          logger.info("Skip renewal: missing token", { uid });
          continue;
        }

        if (!subEnd || Number.isNaN(subEnd.getTime())) {
          logger.info("Skip renewal: invalid subscriptionEnd", { uid, subscriptionEnd: billing.subscriptionEnd });
          continue;
        }

        if (subEnd > renewUntil) {
          logger.info("Skip renewal: not due yet", { uid, subscriptionEnd: subEnd.toISOString() });
          continue;
        }

        const lastRenewalAttemptAt = billing.lastRenewalAttemptAt?.toDate
          ? billing.lastRenewalAttemptAt.toDate()
          : billing.lastRenewalAttemptAt
          ? new Date(billing.lastRenewalAttemptAt)
          : null;

        const renewalKey = `${subEnd.getFullYear()}-${String(subEnd.getMonth() + 1).padStart(2, "0")}-${String(subEnd.getDate()).padStart(2, "0")}`;

        if (
          billing.lastRenewalKey === renewalKey &&
          lastRenewalAttemptAt &&
          !Number.isNaN(lastRenewalAttemptAt.getTime())
        ) {
          logger.info("Skip renewal: already attempted for this cycle", { uid, renewalKey });
          continue;
        }

        const plan = PLANS[billing.plan];
        if (!plan) {
          logger.error("Skip renewal: invalid plan", { uid, plan: billing.plan });
          continue;
        }

        const amount = billing.billingMode === "annual" ? plan.annual : plan.monthly;
        if (!amount || amount <= 0) {
          logger.info("Skip renewal: zero amount", { uid, plan: billing.plan, billingMode: billing.billingMode });
          continue;
        }

        const cardValidityMonth =
          billing.cardValidityMonth ||
          billing.cardcomCardValidityMonth ||
          billing.tokenCardValidityMonth ||
          null;

        const cardValidityYear =
          billing.cardValidityYear ||
          billing.cardcomCardValidityYear ||
          billing.tokenCardValidityYear ||
          null;

        if (!cardValidityMonth || !cardValidityYear) {
          logger.error("Skip renewal: missing card validity", {
            uid,
            hasMonth: !!cardValidityMonth,
            hasYear: !!cardValidityYear,
          });

          await doc.ref.set(
            {
              lastRenewalKey: renewalKey,
              lastRenewalAttemptAt: FieldValue.serverTimestamp(),
              lastRenewalStatus: "missing_card_validity",
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          continue;
        }

        await doc.ref.set(
          {
            lastRenewalKey: renewalKey,
            lastRenewalAttemptAt: FieldValue.serverTimestamp(),
            lastRenewalStatus: "processing",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const chargeRes = await chargeCardcomToken({
          token,
          amount,
          cardValidityMonth,
          cardValidityYear,
        });

        logger.info("Cardcom token charge response", {
          uid,
          ok: chargeRes.ok,
          parsed: chargeRes.parsed,
        });

        if (!chargeRes.ok) {
          await doc.ref.set(
            {
              lastRenewalStatus: "failed",
              lastRenewalResponseCode: chargeRes.parsed.ResponseCode || null,
              lastRenewalResponseDescription: chargeRes.parsed.Description || null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          continue;
        }

        const nextSubEnd = new Date(subEnd);
        if (billing.billingMode === "annual") {
          nextSubEnd.setFullYear(nextSubEnd.getFullYear() + 1);
        } else {
          nextSubEnd.setMonth(nextSubEnd.getMonth() + 1);
        }

        const paymentRef = db.collection("payments").doc();
        const updateData = {
          status: "active",
          subscriptionEnd: nextSubEnd,
          lastPaymentAmount: amount,
          lastPaymentAt: now,
          lastRenewalStatus: "success",
          lastRenewalResponseCode: chargeRes.parsed.ResponseCode || null,
          lastRenewalResponseDescription: chargeRes.parsed.Description || null,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (billing.plan === "bundle" || String(billing.plan || "").startsWith("bundle-")) {
          const bundle = PLANS[billing.plan];
          Object.entries(bundle.includes || {}).forEach(([productId, planId]) => {
            updateData[`plans.${productId}`] = {
              plan: planId,
              status: "active",
              subscriptionEnd: nextSubEnd,
              billingMode: billing.billingMode,
            };
          });
        } else {
          updateData[`plans.omdan-leak`] = {
            plan: billing.plan,
            status: "active",
            subscriptionEnd: nextSubEnd,
            billingMode: billing.billingMode,
          };
        }

        await db.runTransaction(async (t) => {
          t.set(doc.ref, updateData, { merge: true });
          t.set(paymentRef, {
            uid,
            billingMode: billing.billingMode,
            amount,
            product: "omdan-leak",
            processedAt: now,
            type: "renewal",
            planId: billing.plan,
            cardcomInternalDealNumber: chargeRes.parsed.InternalDealNumber || null,
            cardcomResponseCode: chargeRes.parsed.ResponseCode || null,
            cardcomDescription: chargeRes.parsed.Description || null,
          });
        });

        logger.info("Renewal success", {
          uid,
          amount,
          nextSubscriptionEnd: nextSubEnd.toISOString(),
        });
      } catch (e) {
        logger.error("Renewal error", {
          uid,
          error: e.message,
        });

        await doc.ref.set(
          {
            lastRenewalStatus: "error",
            lastRenewalError: e.message || String(e),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    logger.info("Renewal check finished");
  }
);

// ── Health check ──────────────────────────────────────────
exports.health = onRequest({ region: "us-central1" }, (req, res) => {
  res.json({ ok: true, service: "omda-leak-functions", ts: Date.now() });
});