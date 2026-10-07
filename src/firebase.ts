import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// `getReactNativePersistence` is real and ships in @firebase/auth, but only in its
// "react-native"-condition build (dist/rn/index.rn.d.ts); the type resolver (tsc, under
// `customConditions: ["react-native"]`) instead matches @firebase/auth's package.json's bare
// `"types"` entry — which comes first in its exports map and points at a cross-platform surface
// that doesn't declare this function — so a static `import { getReactNativePersistence } from
// '@firebase/auth'` fails to typecheck even though Metro resolves the real thing fine at runtime.
// Reaching it through the untyped CJS require keeps that one, local, and contained here, instead
// of an ambient `declare module '@firebase/auth'` augmentation, which (tried first) clobbered
// every other file's view of the real, correctly-typed `firebase/auth` module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getReactNativePersistence } = require('@firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

// Firebase project config (see .env) — this is NOT a secret. Firebase's web config is meant to be
// public; access to user data is controlled by Firestore Security Rules (see firestore.rules),
// not by hiding these values.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth (not getAuth) + AsyncStorage persistence: without this, Firebase Auth on React
// Native falls back to in-memory-only persistence and signs the user out on every app restart.
// Fast Refresh re-imports this module and calls initializeAuth a second time, which throws
// `auth/already-initialized` — fall back to the already-initialized instance via getAuth.
let auth: Auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  auth = getAuth(app);
}
export { auth };

export const db = getFirestore(app);
