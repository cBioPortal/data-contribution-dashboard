import { useEffect, useState } from 'react';
import { authReady } from '@/services/keycloak';

/**
 * Snapshot of the mirrored token, captured the moment Keycloak settles.
 *
 * Kept at module scope so a component mounting *after* authentication has
 * resolved can read the answer synchronously on its first render. Without this,
 * useState always started at `undefined` and the value only arrived in a
 * microtask, so ProtectedRoute painted "Checking authentication..." for a frame
 * on every in-app navigation — even though the session had been known for
 * seconds.
 */
let settled = false;
let snapshot: string | null = null;

authReady.then(() => {
  settled = true;
  snapshot = localStorage.getItem('authToken');
});

/**
 * The mirrored auth token, read once Keycloak has finished resolving.
 *
 * Returns `undefined` while authentication is still in flight, which callers
 * must treat as "not known yet" rather than "logged out" — the app paints before
 * Keycloak settles, so reading localStorage on mount would report every user as
 * anonymous for the first moments of the page's life.
 */
export function useAuthToken(): string | null | undefined {
  // Seeded from the snapshot when auth already resolved, so there is no
  // undefined render to flash through.
  const [token, setToken] = useState<string | null | undefined>(
    () => (settled ? snapshot : undefined));

  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    authReady.then(() => {
      if (!cancelled) setToken(localStorage.getItem('authToken'));
    });
    return () => { cancelled = true; };
  }, []);

  return token;
}
