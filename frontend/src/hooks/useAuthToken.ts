import { useEffect, useState } from 'react';
import { authReady } from '@/services/keycloak';

/**
 * The mirrored auth token, read once Keycloak has finished resolving.
 *
 * Returns `undefined` while authentication is still in flight, which callers
 * must treat as "not known yet" rather than "logged out" — the app now paints
 * before Keycloak settles, so reading localStorage on mount would report every
 * user as anonymous for the first second of the page's life.
 */
export function useAuthToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    authReady.then(() => {
      if (!cancelled) setToken(localStorage.getItem('authToken'));
    });
    return () => { cancelled = true; };
  }, []);

  return token;
}
