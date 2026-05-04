/**
 * OMDA Leak — restored functions index
 *
 * Purpose:
 * Keep local source aligned with functions that already exist in Firebase:
 * - legacy case/billing/config endpoints are restored so deploy will not try to delete them
 * - current Cardcom implementation remains delegated to ./cardcom
 * - current PDF implementation remains delegated to ./generatePdf
 */

const admin = require("firebase-admin");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";
const CASES_COLLECTION = "cases";

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────
function applyCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

function jsonBody(req) {
  if (typeof req.body === "object" && req.body !== null) return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function buildLeakSummary(payload = {}) {
  const parts = [];
  if (payload.issue) parts.push(`נושא הקריאה: ${payload.issue}`);
  if (payload.area) parts.push(`אזור בדיקה: ${payload.area}`);
  if (payload.cause) parts.push(`מקור משוער: ${payload.cause}`);
  if (payload.certainty) parts.push(`רמת ודאות: ${payload.certainty}`);
  if (payload.recommendation) parts.push(`המלצה: ${payload.recommendation}`);
  return parts.join(" | ");
}

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "נדרשת התחברות.");
  }
  return request.auth;
}

function privateConfigRef(name) {
  return db.collection("privateConfigs").doc(name);
}

function mask(value = "") {
  if (!value) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}

// ─────────────────────────────────────────────
// Health
// Existing cloud function name: health
// ─────────────────────────────────────────────
exports.health = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  res.json({
    success: true,
    ok: true,
    service: "omda-leak-functions",
    module: "leak",
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// Legacy/basic case endpoints restored from cloud source
// Existing cloud function names: createCase, listCases, getCase, processCase
// ─────────────────────────────────────────────
exports.createCase = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const body = jsonBody(req);
  const payload = body.payload || body;
  const moduleName = body.module || "leak";
  const type = body.type || "leak";

  if (!payload.customer && !payload.title) {
    return res.status(400).json({ success: false, message: "Missing customer or title" });
  }

  const doc = {
    module: moduleName,
    type,
    status: payload.status || "טיוטה",
    payload,
    summary: buildLeakSummary(payload),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection(CASES_COLLECTION).add(doc);
  logger.info("Case created", { caseId: ref.id, module: moduleName, type });

  return res.json({
    success: true,
    caseId: ref.id,
    module: moduleName,
    status: doc.status,
    message: "Leak case created successfully",
  });
});

exports.listCases = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  const moduleName = req.query.module || "leak";
  const limit = Math.min(Number(req.query.limit || 25), 100);

  const query = db.collection(CASES_COLLECTION)
    .where("module", "==", moduleName)
    .orderBy("createdAt", "desc")
    .limit(limit);

  const snap = await query.get();
  const items = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return res.json({ success: true, count: items.length, items });
});

exports.getCase = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  const caseId = req.query.caseId || req.query.id;
  if (!caseId) {
    return res.status(400).json({ success: false, message: "Missing caseId" });
  }

  const doc = await db.collection(CASES_COLLECTION).doc(caseId).get();
  if (!doc.exists) {
    return res.status(404).json({ success: false, message: "Case not found" });
  }

  return res.json({ success: true, caseId: doc.id, data: doc.data() });
});

exports.processCase = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  const body = req.method === "POST" ? jsonBody(req) : {};
  const caseId = req.query.caseId || req.query.id || body.caseId;
  if (!caseId) {
    return res.status(400).json({ success: false, message: "Missing caseId" });
  }

  const ref = db.collection(CASES_COLLECTION).doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) {
    return res.status(404).json({ success: false, message: "Case not found" });
  }

  const data = snap.data() || {};
  const payload = data.payload || {};
  const summary = buildLeakSummary(payload);

  await ref.update({
    summary,
    route: "leak",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.json({
    success: true,
    caseId,
    route: "leak",
    module: data.module || "leak",
    summary,
    suggestedNextStep: payload.recommendation || "השלמת דוח והעברה לטיפול בהתאם לממצא",
    message: "Leak case routed successfully",
  });
});

// ─────────────────────────────────────────────
// Legacy billing placeholders restored from cloud source
// Existing cloud function names: createBillingSession, billingWebhook
// NOTE: real Cardcom production billing remains in ./cardcom exports below.
// ─────────────────────────────────────────────
exports.createBillingSession = onRequest({ region: REGION }, (req, res) => {
  logger.info("Legacy createBillingSession placeholder", { body: req.body || null });
  res.status(501).json({
    ok: false,
    message: "Legacy billing session endpoint. Use cardcomCreatePayment for active billing flow.",
  });
});

exports.billingWebhook = onRequest({ region: REGION }, (req, res) => {
  logger.info("Legacy billingWebhook placeholder", { body: req.body || null, query: req.query || null });
  res.status(200).send("legacy webhook placeholder");
});

// ─────────────────────────────────────────────
// Legacy callable Cardcom config endpoints restored from cloud source
// Existing cloud function names: getCardcomConfig, saveCardcomConfig
// ─────────────────────────────────────────────
exports.getCardcomConfig = onCall({ region: REGION }, async (request) => {
  requireAuth(request);
  const snap = await privateConfigRef("cardcom").get();
  const data = snap.exists ? snap.data() : {};
  return {
    terminalNumber: data.terminalNumber || "",
    userName: data.userName || "",
    successUrl: data.successUrl || "",
    errorUrl: data.errorUrl || "",
    indicatorUrl: data.indicatorUrl || "",
    terminalMasked: mask(data.terminalNumber || ""),
    userMasked: mask(data.userName || ""),
    isConfigured: Boolean(data.terminalNumber && data.userName),
    updatedAt: data.updatedAt || null,
  };
});

exports.saveCardcomConfig = onCall({ region: REGION }, async (request) => {
  const auth = requireAuth(request);
  const data = request.data || {};
  await privateConfigRef("cardcom").set(
    {
      terminalNumber: String(data.terminalNumber || "").trim(),
      userName: String(data.userName || "").trim(),
      successUrl: String(data.successUrl || "").trim(),
      errorUrl: String(data.errorUrl || "").trim(),
      indicatorUrl: String(data.indicatorUrl || "").trim(),
      updatedBy: auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
});

// ─────────────────────────────────────────────
// Current production Cardcom implementation
// Existing cloud function names: cardcomCreatePayment, cardcomWebhook, cardcomRenewSubscriptions
// ─────────────────────────────────────────────
const cardcom = require("./cardcom");
exports.cardcomCreatePayment = cardcom.cardcomCreatePayment;
exports.cardcomWebhook = cardcom.cardcomWebhook;
exports.cardcomRenewSubscriptions = cardcom.cardcomRenewSubscriptions;

// ─────────────────────────────────────────────
// Current PDF implementation
// Existing cloud function name: generateLeakPdf
// ─────────────────────────────────────────────
const { generateLeakPdf } = require("./generatePdf");
exports.generateLeakPdf = generateLeakPdf;
