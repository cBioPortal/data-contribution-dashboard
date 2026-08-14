/**
 * Runtime configuration.
 *
 * In a container these values come from `/config.js`, which the image entrypoint
 * rewrites from environment variables at startup (see docker-entrypoint.sh). That
 * lets one published frontend image be promoted across dev/staging/prod instead of
 * being rebuilt per environment, since Vite would otherwise freeze them into the
 * bundle at build time.
 *
 * Precedence: runtime (window.__ENV__) -> build-time (.env) -> local dev default.
 */

declare global {
  interface Window {
    __ENV__?: Record<string, string | undefined>;
  }
}

// Vite only substitutes *statically written* `import.meta.env.VITE_X` references at
// build time. Dynamic indexing (import.meta.env[key]) works in dev but silently
// yields undefined in a production build, so each var is spelled out here.
const buildTime = {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_KEYCLOAK_URL: import.meta.env.VITE_KEYCLOAK_URL,
  VITE_KEYCLOAK_REALM: import.meta.env.VITE_KEYCLOAK_REALM,
  VITE_KEYCLOAK_CLIENT_ID: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
} as const;

const pick = (key: keyof typeof buildTime, fallback: string): string =>
  window.__ENV__?.[key] || buildTime[key] || fallback;

export const API_URL = pick("VITE_API_URL", "http://localhost:5001");
export const KEYCLOAK_URL = pick("VITE_KEYCLOAK_URL", "http://localhost:8081");
export const KEYCLOAK_REALM = pick("VITE_KEYCLOAK_REALM", "dashboard");
export const KEYCLOAK_CLIENT_ID = pick("VITE_KEYCLOAK_CLIENT_ID", "dashboard-frontend");
