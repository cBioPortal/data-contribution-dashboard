import Keycloak from 'keycloak-js';

/**
 * Keycloak singleton for the dashboard.
 *
 * The access token is mirrored into `localStorage.authToken` so the existing
 * API helpers (services/api.ts) and ProtectedRoute — which read that key —
 * keep working unchanged. Keycloak remains the source of truth; localStorage is
 * just a transport for the current bearer token.
 */
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8081',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'dashboard',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'dashboard-frontend',
});

function syncToken() {
  if (keycloak.authenticated && keycloak.token) {
    localStorage.setItem('authToken', keycloak.token);
  } else {
    localStorage.removeItem('authToken');
  }
}

let initialized = false;

/** Initialize Keycloak once. Uses check-sso so login stays optional. */
export async function initKeycloak() {
  if (initialized) return keycloak;
  initialized = true;
  try {
    await keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      pkceMethod: 'S256',
      checkLoginIframe: false,
    });
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
