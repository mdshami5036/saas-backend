const admin = require('firebase-admin');

let firebaseAdminApp = null;

try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseAdminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Default fallback initialization
      firebaseAdminApp = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'autoprint-saas',
      });
    }
  } else {
    firebaseAdminApp = admin.app();
  }
} catch (error) {
  console.warn('[Firebase Admin Warning]:', error.message);
}

async function verifyFirebaseToken(idToken) {
  try {
    if (admin.apps.length) {
      return await admin.auth().verifyIdToken(idToken);
    }
  } catch (err) {
    console.warn('[Firebase Token Verify Warning]:', err.message);
  }
  return null;
}

module.exports = {
  admin,
  verifyFirebaseToken,
};
