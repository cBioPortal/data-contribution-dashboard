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
    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).then(syncToken).catch(syncToken);
    };
  } catch (e) {
    console.error('Keycloak init failed', e);
    syncToken();
  }
  return keycloak;
}

/** Start login. Pass an idpHint to jump straight to Google/GitHub. */
export function login(idpHint?: 'google' | 'github') {
  return keycloak.login({
    redirectUri: `${window.location.origin}/`,
    ...(idpHint ? { idpHint } : {}),
  });
}

/** RP-initiated logout — also ends the Keycloak session. */
export function logout() {
  localStorage.removeItem('authToken');
  return keycloak.logout({ redirectUri: `${window.location.origin}/` });
}

export default keycloak;
