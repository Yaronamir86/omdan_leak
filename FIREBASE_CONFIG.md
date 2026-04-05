# הגדרת Firebase Config — OMDA איתור

## פרויקט Firebase
- **Project ID:** `omdan-leak`
- **Hosting:** `omdan-leak.web.app`

## קבצים שדורשים עדכון Firebase Config

החלף `YOUR_OMDA_ITUR_API_KEY`, `YOUR_SENDER_ID`, `YOUR_APP_ID` בערכים האמיתיים מ-Firebase Console:

### קבצים עם compat SDK (החלפה ידנית):
- `hosting/app/dashboard.html`
- `hosting/app/case.html`
- `hosting/index.html`
- `hosting/register.html`

### קבצים עם module SDK (כבר עם ערכי placeholder):
- `hosting/app/settings.html`
- `hosting/app/account-billing.html`
- `hosting/app/payments.html`
- `hosting/app/reports.html`
- `hosting/billing-success.html`

### קובץ billing.js
- `hosting/billing.js` — עדכן `BILLING_FIREBASE_CONFIG`

## אופן החלפה מהירה (PowerShell / bash)
```bash
# הרץ מתוך תיקיית omda-itur
find hosting -name "*.html" -o -name "*.js" | xargs sed -i \
  's/YOUR_OMDA_ITUR_API_KEY/AIzaSy.../g; 
   s/YOUR_SENDER_ID/123.../g; 
   s/YOUR_APP_ID/1:123...web:.../g'
```

## אחרי Deploy
- הגדר Cardcom credentials ב-Secret Manager:
  - `CARDCOM_TERMINAL`
  - `CARDCOM_USERNAME`
