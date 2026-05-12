// ═══════════════════════════════════════════════════════════════
//  ⚠  REPLACE THIS WITH YOUR OWN FIREBASE CONFIG
//  1. Go to https://console.firebase.google.com
//  2. Create project → Add web app → copy firebaseConfig
//  3. Realtime Database → Create database (start in test mode)
//  4. Authentication → Sign-in method → Enable Email/Password AND Anonymous
//  5. Paste your config below, then set these DB Rules:
//
//  REALTIME DATABASE RULES  (Database → Rules tab → paste & publish):
//  {
//    "rules": {
//      "users": {
//        ".read":  "auth != null",
//        "$uid": {
//          "public":  { ".write": "auth != null && auth.uid == $uid" },
//          "private": { ".read": "auth != null && auth.uid == $uid", ".write": "auth != null && auth.uid == $uid" }
//        }
//      },
//      "usernames": {
//        ".read": true,
//        "$username": { ".write": "auth != null && (!data.exists() || data.val() == auth.uid)" }
//      },
//      "wallets": {
//        ".read":  "auth != null",
//        "$uid": { ".write": "auth != null" }
//      },
//      "txs": {
//        "$uid": { ".read": "auth != null && auth.uid == $uid", ".write": "auth != null" }
//      },
//      "dms":{"\.read":"auth != null","$d":{"\.write":"auth != null","messages":{"$m":{"\.validate":"newData.hasChildren(['from','text','ts']) && newData.child('text').val().length <= 2000"}}}},
//      "groups":{"\.read":"auth != null","$g":{"\.write":"auth != null","messages":{"$m":{"\.validate":"newData.hasChildren(['from','ts'])"}}}},
//      "presence": { ".read": "auth != null", ".write": "auth != null" },
//      "pubrooms": { ".read": "auth != null", ".write": "auth != null" }
//    }
//  }
//
//  NOTE: usernames is publicly readable so username-availability checks work
//  before sign-in. users and wallets are readable by any signed-in user.
//  Private profile data (users/$uid/private) is owner-only.
// ═══════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyArNHM3dKMRaF4Plz8ScrAmWZV3JRaWJ8g",
  authDomain: "ghost-msg.firebaseapp.com",
  databaseURL: "https://ghost-msg-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ghost-msg",
  storageBucket: "ghost-msg.firebasestorage.app",
  messagingSenderId: "1002745894314",
  appId: "1:1002745894314:web:9e476ac256533e944f87d3",
  measurementId: "G-GFR4TMP8VV"
};
// ═══════════════════════════════════════════════════════════════