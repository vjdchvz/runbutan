import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { syncNow } from './sync';

// Required for the OAuth browser tab to close itself and hand control back to the app on Android.
WebBrowser.maybeCompleteAuthSession();

const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined;
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;
// Whether the Android-type OAuth client (package name + SHA-1, see .env) has actually been set up
// yet. Without it, expo-auth-session's Google hook would throw on first render (it requires
// *some* androidClientId on Android) — googleSignInReady lets the UI show a clear "not set up"
// state instead of crashing the Settings screen.
export const googleSignInReady = !!ANDROID_CLIENT_ID;

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
 * The Google sign-in round trip: opens the account picker in a browser tab, then signs the
 * resulting Google ID token into Firebase. `expo-auth-session/providers/google` is flagged
 * deprecated upstream in favour of a native module (@react-native-google-signin/google-signin),
 * but it's still fully supported in this SDK and needs no extra native setup beyond the Android
 * OAuth client above — the simpler trade for a personal project without Play Store distribution.
 *
 * On Android this is a PKCE authorization-code flow under the hood (no client secret involved);
 * the hook auto-exchanges the code for tokens and surfaces the id token at
 * `response.params.id_token` once that exchange finishes — see expo-auth-session's own
 * providers/Google.js for exactly how, since the public docs for it are the deprecated page.
 */
export const useGoogleSignIn = () => {
  const [request, response, promptAsync] = useIdTokenAuthRequest({
    androidClientId: ANDROID_CLIENT_ID ?? 'not-configured',
    webClientId: WEB_CLIENT_ID,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (response?.type !== 'success') {
      if (response?.type === 'error') setError(response.error?.message ?? 'Sign-in was cancelled or failed.');
      return;
    }
    const idToken = response.params?.id_token ?? response.authentication?.idToken;
    if (!idToken) {
      setError('Google did not return an ID token.');
      return;
    }
    setPending(true);
    setError(null);
    signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
      .catch((e) => setError(e?.message ?? 'Sign-in failed.'))
      .finally(() => setPending(false));
  }, [response]);

  return {
    signIn: () => promptAsync(),
    ready: googleSignInReady && !!request,
    pending,
    error,
  };
};
