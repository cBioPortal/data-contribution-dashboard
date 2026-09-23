import Keycloak from 'keycloak-js';
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } from '@/config';

/**
 * Keycloak singleton for the dashboard.
 *
 * The access token is mirrored into `localStorage.authToken` so the existing
 * API helpers (services/api.ts) and ProtectedRoute — which read that key —
 * keep working unchanged. Keycloak remains the source of truth; localStorage is
 * just a transport for the current bearer token.
 */
const keycloak = new Keycloak({
  url: KEYCLOAK_URL,
  realm: KEYCLOAK_REALM,
  clientId: KEYCLOAK_CLIENT_ID,
});

function syncToken() {
  if (keycloak.authenticated && keycloak.token) {
    localStorage.setItem('authToken', keycloak.token);
  } else {
    localStorage.removeItem('authToken');
  }
}

/**
 * Hard cap on Keycloak initialisation.
 *
 * keycloak-js settles the `check-sso` promise only when its hidden iframe posts
 * back, and that promise carries no timeout of its own. If the iframe can't
 * complete the round trip — an unregistered redirect URI, a renamed realm, an
 * unreachable server — it never settles, and because main.tsx renders in
 * `.finally()` the app stays permanently blank with nothing logged.
 *
 * Losing SSO degrades gracefully (login is optional for browsing). A blank page
 * does not. So we bound the wait and render regardless.
 */
const INIT_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Keycloak init did not settle within ${ms}ms`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * Resolves once initKeycloak() has settled, whether or not a session was found.
 *
 * The app renders before authentication finishes, so anything reading the
 * mirrored token must wait on this rather than reading localStorage on mount.
 * Otherwise a logged-in user looks anonymous for the first second — and
 * ProtectedRoute would redirect them to the login page before their session
 * had a chance to load.
 */
let markAuthReady: () => void;
export const authReady = new Promise<void>((resolve) => { markAuthReady = resolve; });

let authSettled = false;
void authReady.then(() => { authSettled = true; });

export interface TokenIdentity {
  email: string;
  isSuperUser: boolean;
}

/**
 * Identity taken from the access token itself, read synchronously.
 *
 * Role and email are claims Keycloak has already signed, and the API derives the
 * role from exactly these — see middleware/auth.js, which reads
 * `realm_access.roles` and checks for `super`. Asking /api/auth/profile for them
 * spends a round trip re-answering a question the token has already answered,
 * and the answer arrives after the grids have rendered, so every one of them is
 * torn down and rebuilt when it lands.
 *
 * The app's own user id is deliberately not here: the token carries Keycloak's
 * `sub`, not the row id the API assigns, so that still comes from the profile
 * endpoint — it just no longer gates anything visible.
 *
 * Returns `undefined` while Keycloak is still resolving, `null` once it has
 * resolved with no session. Callers must not read `undefined` as "logged out".
 */
export function tokenIdentity(): TokenIdentity | null | undefined {
  if (!authSettled) return undefined;
  if (!keycloak.authenticated || !keycloak.tokenParsed) return null;

  const claims = keycloak.tokenParsed as {
    email?: string;
    realm_access?: { roles?: string[] };
  };
  return {
    email: claims.email ?? '',
    isSuperUser: claims.realm_access?.roles?.includes('super') ?? false,
  };
}

let initialized = false;

/** Initialize Keycloak once. Uses check-sso so login stays optional. */
export async function initKeycloak() {
  if (initialized) return keycloak;
  initialized = true;

  try {
    await withTimeout(
      keycloak.init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        pkceMethod: 'S256',
        checkLoginIframe: false,
      }),
      INIT_TIMEOUT_MS,
    );
    syncToken();
    // Keep the mirrored token fresh as it nears expiry.
    // Proactive refresh on expiry. ensureFreshToken() clears the mirrored token
    // when renewal fails, rather than re-writing the expired one.
    keycloak.onTokenExpired = () => { void ensureFreshToken(); };
  } catch (e) {
    console.error('Keycloak init failed', e);
    syncToken();
  } finally {
    // Unblock waiters either way: a failed init means "not logged in", not
    // "keep waiting". Leaving this unresolved would hang every auth-dependent
    // view indefinitely.
    markAuthReady();
  }
  return keycloak;
}

/**
 * Return a token that is valid for at least `minValiditySeconds`, refreshing it
 * through Keycloak first if necessary.
 *
 * Call this before every authenticated request. Access tokens are short-lived —
 * five minutes by default — and filling in the submission form takes far longer
 * than that, so relying on the onTokenExpired timer alone meant a user who read
 * the form before submitting hit "Invalid or expired token". updateToken() is a
 * cheap no-op while the token is still valid, and each successful call also
 * resets Keycloak's SSO idle timer, so an active user's session stays alive.
 *
 * Returns null when the session cannot be renewed. Callers should send the user
 * back to log in rather than retrying with a token the API will reject.
 */
export async function ensureFreshToken(minValiditySeconds = 60): Promise<string | null> {
  if (!keycloak.authenticated) {
    localStorage.removeItem('authToken');
    return null;
  }
  try {
    await keycloak.updateToken(minValiditySeconds);
    syncToken();
    return keycloak.token ?? null;
  } catch {
    // The refresh token is gone or the SSO session ended. Drop the mirrored
    // token — writing the expired one back is what previously left the app
    // wedged, retrying forever with a token that could never succeed.
    localStorage.removeItem('authToken');
    return null;
  }
}

/** Start login. Pass a same-origin path to return to the current workflow. */
export function login(idpHint?: 'google' | 'github', returnPath = '/') {
  const requestedUrl = new URL(returnPath, window.location.origin);
  const redirectUri = requestedUrl.origin === window.location.origin
    ? requestedUrl.toString()
    : `${window.location.origin}/`;
  return keycloak.login({
    redirectUri,
    ...(idpHint ? { idpHint } : {}),
  });
}

/** RP-initiated logout — also ends the Keycloak session. */
export function logout() {
  localStorage.removeItem('authToken');
  return keycloak.logout({ redirectUri: `${window.location.origin}/` });
}

export default keycloak;
