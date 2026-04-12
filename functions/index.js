const admin = require('firebase-admin');
admin.initializeApp();

const { generateLeakPdf } = require('./generatePdf');

exports.generateLeakPdf = generateLeakPdf;
