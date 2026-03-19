Firebase setup checklist

1. Create Firebase project
2. Enable Authentication
   - Email/Password
3. Create Firestore database
4. Create Storage bucket
5. Replace firebase-config.example.js with real firebase-config.js
6. Deploy:
   firebase deploy --only hosting,firestore:rules,firestore:indexes,storage,functions

Collections expected:
- users
- reports
- customers
- billingSessions
- activityLog
- settings

Recommended owner user document:
users/{uid}
{
  "role": "owner",
  "email": "your@email.com",
  "displayName": "Your Name",
  "createdAt": "<server timestamp>"
}
