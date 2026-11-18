import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCn-4GNsQQaPN5moJivg2Cj9W0TJkiteRE",
  authDomain: "test-noorulislam.firebaseapp.com",
  projectId: "test-noorulislam",
  firestoreDatabaseId: "default",
  storageBucket: "test-noorulislam.firebasestorage.app",
  messagingSenderId: "192594386980",
  appId: "1:192594386980:web:bbd6a0e7c17674ae1538b1",
  measurementId: "G-KT2PG0G8JV"
};

const app = initializeApp(firebaseConfig);
if (typeof window !== 'undefined') {
  window.AppSession?.syncFirebaseProject?.(firebaseConfig.projectId);
}

const appCheckSiteKey = String(window.__APP_CHECK_SITE_KEY || '').trim();
const canEnableAppCheck = appCheckSiteKey && appCheckSiteKey !== 'REPLACE_WITH_RECAPTCHA_V3_SITE_KEY';
const appCheck = canEnableAppCheck
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    })
  : null;

if (!canEnableAppCheck) {
  console.warn('[Security] App Check is not enabled yet: set window.__APP_CHECK_SITE_KEY with a valid reCAPTCHA v3 site key.');
}

const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? initializeFirestore(app, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId)
  : initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
if (typeof window !== 'undefined') {
  window.__firebaseAuth = auth;
}

export { app, db, auth, appCheck, canEnableAppCheck, firebaseConfig };
