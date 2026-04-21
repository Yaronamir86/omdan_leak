const admin = require('firebase-admin');
admin.initializeApp();

const cardcom = require('./cardcom');

exports.cardcomCreatePayment = cardcom.cardcomCreatePayment;
exports.cardcomWebhook = cardcom.cardcomWebhook;
exports.cardcomRenewSubscriptions = cardcom.cardcomRenewSubscriptions;

const { generateLeakPdf } = require('./generatePdf');
exports.generateLeakPdf = generateLeakPdf;