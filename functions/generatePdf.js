const functions = require('firebase-functions');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { v4: uuidv4 } = require('uuid');

// ── generateLeakPdf ──────────────────────────────────────────────────────────
// HTTP callable: receives report data, renders HTML, produces PDF,
// uploads to Firebase Storage, returns a signed download URL.
// ─────────────────────────────────────────────────────────────────────────────
exports.generateLeakPdf = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {

    // ── Auth guard ──
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const uid = context.auth.uid;
    const {
      caseId,
      htmlPayload,  // full report HTML string
      logoUrl,      // optional: absolute URL (Firebase Storage signed URL)
      signatureUrl, // optional: absolute URL
      pdfBranding,  // optional: repeated PDF header branding
    } = data;

    if (!htmlPayload) {
      throw new functions.https.HttpsError('invalid-argument', 'htmlPayload is required');
    }

    // ── Build full HTML page ──
    const fullHtml = buildHtmlPage(htmlPayload, logoUrl, signatureUrl);
    const pdfLogoMode = pdfBranding?.pdfLogoMode === 'allPages' ? 'allPages' : 'firstPageOnly';
    const repeatedHeaderTemplate = pdfLogoMode === 'allPages'
      ? buildPdfHeaderTemplate(pdfBranding || {})
      : '<div></div>';
    const repeatedHeaderTopMargin = pdfLogoMode === 'allPages'
      ? `${calculatePdfHeaderTopMargin(pdfBranding || {})}px`
      : '15mm';

    // ── Puppeteer → PDF ──
    let browser;
    try {
     browser = await puppeteer.launch({
  args: chromium.args,
  defaultViewport: chromium.defaultViewport,
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});

      const page = await browser.newPage();

      // Allow all Firebase Storage URLs + Google Fonts
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        const allowed = [
          'firebasestorage.googleapis.com',
          'storage.googleapis.com',
          'fonts.googleapis.com',
          'fonts.gstatic.com',
        ];
        if (allowed.some(h => url.includes(h)) || req.resourceType() !== 'image') {
          req.continue();
        } else {
          // allow all non-blocked
          req.continue();
        }
      });

      await page.setContent(fullHtml, {
        waitUntil: 'networkidle0',
        timeout: 90000,
      });

      // Wait for fonts + images
      await page.evaluateHandle('document.fonts.ready');
      await page.waitForTimeout(800); // extra buffer for remote images

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: repeatedHeaderTopMargin, bottom: '20mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: repeatedHeaderTemplate,
        footerTemplate: `
          <div style="
            width:100%;font-size:9px;color:#9ca3af;
            font-family:'Heebo',sans-serif;
            display:flex;justify-content:space-between;
            padding:0 12mm;box-sizing:border-box;
          ">
            <span>OMDA איתור נזילות</span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
      });

      await browser.close();

      // ── Upload to Firebase Storage ──
      const bucket = admin.storage().bucket();
      const fileName = `reports/${uid}/${caseId || uuidv4()}_${Date.now()}.pdf`;
      const file = bucket.file(fileName);

      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: { uid, caseId: caseId || '' },
        },
      });

      // Signed URL valid 7 days
      // Public URL — Storage rules יגנו עליו
await file.makePublic();
const signedUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      // Also save the path to Firestore for future retrieval
      if (caseId) {
        await admin.firestore()
          .collection('leakCases')
          .doc(caseId)
          .set({ pdfUrl: signedUrl, pdfPath: fileName, pdfGeneratedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }

      return { success: true, url: signedUrl, path: fileName };

    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      console.error('generateLeakPdf error:', err);
      throw new functions.https.HttpsError('internal', err.message);
    }
  });


// ── buildHtmlPage ────────────────────────────────────────────────────────────
// Wraps the report HTML in a complete, self-contained page:
// • Heebo font (Google Fonts)
// • RTL direction
// • A4-ready CSS
// • Page-break rules
// • Dynamic logo / signature via <img> if URLs provided
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function svgInitialsLogoDataUri({ initials, size, bg, fg }) {
  const safeInitials = escapeXml(initials || 'OM').slice(0, 4);
  const safeBg = /^#[0-9a-fA-F]{3,8}$/.test(String(bg || '')) ? bg : '#2196F3';
  const safeFg = /^#[0-9a-fA-F]{3,8}$/.test(String(fg || '')) ? fg : '#ffffff';
  const radius = Math.round(size * 0.18);
  const fontSize = Math.round(size * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${safeBg}"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="${safeFg}">${safeInitials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}


function calculatePdfHeaderTopMargin(branding) {
  const logoSize = clampNumber(branding.logoSizePx, 80, 160, 90);
  const layout = ['A', 'B', 'C'].includes(branding.logoLayout) ? branding.logoLayout : 'A';

  // Puppeteer renders headerTemplate inside the top margin box.
  // The margin must include the actual logo size + the branding text row + breathing space.
  // Without this, large logos visually collide with the report title/content.
  if (layout === 'B') {
    return Math.round(logoSize + 120);
  }

  return Math.round(Math.max(150, logoSize + 85));
}

function buildPdfHeaderTemplate(branding) {
  const logoSize = clampNumber(branding.logoSizePx, 80, 160, 90);
  const layout = ['A', 'B', 'C'].includes(branding.logoLayout) ? branding.logoLayout : 'A';

  const name = escapeHtml(branding.nameHe || branding.fullName || '');
  const title = escapeHtml(branding.title || '');
  const license = escapeHtml(branding.license || '');
  const phone = escapeHtml(branding.phone || '');
  const email = escapeHtml(branding.email || '');
  const vat = escapeHtml(branding.vat || '');
  const initials = escapeHtml(branding.logoInitials || 'OM');
  const logoColor = branding.logoColor || '#2196F3';
  const logoTextColor = branding.logoTextColor || '#ffffff';

  const logoSrc = branding.logoImageData || svgInitialsLogoDataUri({ initials, size: logoSize, bg: logoColor, fg: logoTextColor });
  const logoHtml = `<img src="${logoSrc}" style="height:${logoSize}px;max-width:${Math.round(logoSize * 2.6)}px;object-fit:contain;display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact;">`;

  const nameBlock = `
    ${name ? `<div style="font-size:15px;font-weight:900;color:#111827;line-height:1.35;margin-bottom:2px;">${name}</div>` : ''}
    ${title ? `<div style="font-size:11px;font-weight:700;color:#6b7280;line-height:1.35;">${title}</div>` : ''}
    ${license ? `<div style="font-size:10px;font-weight:700;color:#374151;line-height:1.35;margin-top:2px;">רישיון מס׳ ${license}</div>` : ''}
  `;

  const contactBlock = `
    ${phone ? `<div style="line-height:1.55;"><span style="font-weight:700;color:#374151;">${phone}</span></div>` : ''}
    ${email ? `<div style="line-height:1.55;color:#374151;">${email}</div>` : ''}
    ${vat ? `<div style="line-height:1.55;color:#374151;">ע.מ ${vat}</div>` : ''}
  `;

  const shellStart = `<div style="width:100%;box-sizing:border-box;padding:10px 12mm 18px 12mm;font-family:Arial,sans-serif;direction:rtl;background:#ffffff;border-bottom:1px solid #e5e7eb;-webkit-print-color-adjust:exact;print-color-adjust:exact;">`;
  const shellEnd = `</div>`;

  if (layout === 'B') {
    return `${shellStart}
      <table dir="rtl" style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr><td style="text-align:center;padding:0 0 6px 0;"><div style="display:inline-block;">${logoHtml}</div></td></tr>
        <tr><td style="text-align:center;font-size:10px;color:#374151;white-space:nowrap;overflow:hidden;">
          ${name ? `<span style="font-size:13px;font-weight:900;color:#111827;">${name}</span>` : ''}
          ${title ? `<span style="margin:0 7px;color:#6b7280;font-weight:700;">${title}</span>` : ''}
          ${license ? `<span style="margin:0 7px;color:#374151;font-weight:700;">רישיון: ${license}</span>` : ''}
          ${phone ? `<span style="margin:0 7px;">${phone}</span>` : ''}
          ${email ? `<span style="margin:0 7px;">${email}</span>` : ''}
          ${vat ? `<span style="margin:0 7px;">ע.מ ${vat}</span>` : ''}
        </td></tr>
      </table>${shellEnd}`;
  }

  return `${shellStart}
    <table dir="rtl" style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        <td style="width:${Math.round(logoSize * 1.25)}px;vertical-align:middle;text-align:right;padding:0 0 0 12px;">${logoHtml}</td>
        <td style="vertical-align:middle;text-align:right;padding:0 12px;border-right:2px solid #e5e7eb;">${nameBlock}</td>
        <td style="width:34%;vertical-align:middle;text-align:left;font-size:10px;color:#6b7280;line-height:1.55;">${contactBlock}</td>
      </tr>
    </table>${shellEnd}`;
}

function buildHtmlPage(bodyHtml, logoUrl, signatureUrl) {
  // Inject logo and signature URLs into the HTML if placeholders exist
  let html = bodyHtml;
  if (logoUrl) {
    // Replace any data-URI logo src with the real URL (puppeteer handles remote fetch)
    html = html.replace(/data-logo-replace="1"[^>]*src="[^"]*"/g,
      `src="${logoUrl}"`);
    // Fallback: replace placeholder comments
    html = html.replace(/<!--LOGO_URL-->/g, `<img src="${logoUrl}" style="max-height:70px;object-fit:contain;display:block;">`);
  }
  if (signatureUrl) {
    html = html.replace(/data-sig-replace="1"[^>]*src="[^"]*"/g,
      `src="${signatureUrl}"`);
    html = html.replace(/<!--SIG_URL-->/g, `<img src="${signatureUrl}" style="max-height:50px;max-width:160px;display:block;">`);
  }

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>דו"ח איתור נזילה</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Base ── */
    html, body {
      font-family: 'Heebo', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      direction: rtl;
      text-align: right;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── A4 page simulation ── */
    body { padding: 0; margin: 0; }

    /* ── Typography ── */
    h1 { font-size: 26px; font-weight: 900; }
    h2 { font-size: 18px; font-weight: 800; }
    h3 { font-size: 15px; font-weight: 800; }
    p  { margin-bottom: 8px; }

    /* ── Tables ── */
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 8px 12px; border: 1px solid #e5e7eb; }
    th { background: #eef2f7; font-weight: 800; color: #1e3a5f; }

    /* ── Page breaks ── */
    .page-break        { page-break-after: always; break-after: page; }
    .avoid-break       { page-break-inside: avoid; break-inside: avoid; }
    table              { page-break-inside: auto; }
    tr                 { page-break-inside: avoid; page-break-after: auto; }
    thead              { display: table-header-group; }
    img                { page-break-inside: avoid; max-width: 100%; }

    /* ── Section titles ── */
    .rpt-section-title {
      font-size: 15px; font-weight: 800; color: #1e3a5f;
      padding-bottom: 7px; margin-bottom: 14px;
      border-bottom: 2px solid #dde3ed;
      display: flex; align-items: center; gap: 6px;
    }
    .rpt-section-title::before {
      content: ''; display: inline-block;
      width: 4px; height: 16px;
      background: #1565C0; border-radius: 2px;
      flex-shrink: 0;
    }

    /* ── Data panels ── */
    .rpt-data-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 14px; margin-bottom: 24px;
    }
    .rpt-data-panel {
      background: #f9fafb; border: 1px solid #e2e8f0;
      border-radius: 10px; overflow: hidden;
    }
    .rpt-data-panel-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 800; color: #1e3a5f;
      padding: 9px 14px; background: #eef2f7;
      border-bottom: 1px solid #dde3ed;
    }
    .rpt-data-panel table { font-size: 13.5px; }
    .rpt-data-panel td {
      padding: 7px 14px; border-bottom: 1px solid #f1f5f9; line-height: 1.6;
      border-right: none; border-left: none; border-top: none;
    }
    .rpt-data-panel tr:last-child td { border-bottom: none; }
    .rpt-data-panel td:first-child { color: #64748b; font-weight: 600; width: 42%; }
    .rpt-data-panel td:last-child  { font-weight: 700; color: #111; }

    /* ── Inspection status colors ── */
    .status-ok      { color: #059669; font-weight: 700; }
    .status-fail    { color: #dc2626; font-weight: 700; }
    .status-partial { color: #d97706; font-weight: 700; }

    /* ── Warning box ── */
    .warning-box {
      background: #fffbeb; border: 1px solid #fde68a;
      border-radius: 8px; padding: 10px 14px;
      font-size: 13px; color: #78350f; line-height: 1.7;
      margin-bottom: 12px;
    }

    /* ── Signature area ── */
    .sig-area {
      margin-top: 40px; padding-top: 28px;
      border-top: 2px solid #e2e8f0; text-align: center;
    }

    /* ── Print footer (injected by puppeteer displayHeaderFooter) ── */
    @media print {
      body { padding: 0 !important; }
    }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}
