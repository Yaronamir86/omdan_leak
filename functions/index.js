const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

exports.health = onRequest((req, res) => {
  res.json({ ok: true, service: "amir-leak-functions" });
});

// Placeholder for future billing session creation
exports.createBillingSession = onRequest((req, res) => {
  logger.info("TODO create billing session", { body: req.body || null });
  res.status(501).json({
    ok: false,
    message: "Billing session creation is scaffolded only. Connect Cardcom/Stripe here."
  });
});

// Placeholder for future webhook
exports.billingWebhook = onRequest((req, res) => {
  logger.info("TODO billing webhook", { body: req.body || null });
  res.status(200).send("webhook scaffold");
});
