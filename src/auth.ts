import { useCallback, useEffect, useState } from 'react';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { syncNow } from './sync';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;
// Whether Google Sign-In has been configured at all. Without a web client ID, GoogleSignin has
// nothing to request an ID token's audience against, so googleSignInReady lets the UI show a
// clear "not set up" state instead of the native module throwing on first sign-in attempt.
export const googleSignInReady = !!WEB_CLIENT_ID;

if (WEB_CLIENT_ID) {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
}

export type AuthState = { user: User | null; loading: boolean };

let state: AuthState = { user: null, loading: true };
const listeners = new Set<(s: AuthState) => void>();
const emit = () => listeners.forEach((l) => l(state));

onAuthStateChanged(auth, (user) => {
  state = { user, loading: false };
  emit();
  if (user) syncNow().catch(() => {});
});

export const getAuthState = () => state;

export const useAuthState = (): AuthState => {
  const [s, setS] = useState(state);
  useEffect(() => {
    const l = (n: AuthState) => setS(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return s;
};

export const signOutUser = () => firebaseSignOut(auth);

/**
 * The Google sign-in round trip: opens the native Google Play Services account picker (no
 * browser tab), then signs the resulting Google ID token into Firebase.
 *
 * This replaces an earlier `expo-auth-session`-based implementation, which Google blocks for
 * apps that haven't verified ownership through Play Console: `expo-auth-session`'s Google flow
 * redirects back into the app via a custom URI scheme, and Google now rejects that redirect for
 * unverified apps with "Error 400: invalid_request — Custom URI scheme is not enabled for your
 * Android client" (an anti-phishing measure, since any app could otherwise register the same
 * scheme and intercept the auth code). The native module below talks to Play Services directly —
 * no redirect, no custom scheme, so the restriction doesn't apply.
 */
export const useGoogleSignIn = () => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!googleSignInReady) return;
    setError(null);
    setPending(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return; // user cancelled the picker
      }
      const idToken = response.data.idToken;
      if (!idToken) {
        setError('Google did not return an ID token.');
        return;
      }
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
        // user cancelled, not an error
      } else {
        setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    } finally {
      setPending(false);
    }
  }, []);

  return { signIn, ready: googleSignInReady, pending, error };
};
