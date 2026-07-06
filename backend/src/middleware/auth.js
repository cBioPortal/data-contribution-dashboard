/**
 * Authentication Middleware
 *
 * Verifies Keycloak-issued OIDC access tokens (RS256) against the realm's
 * JWKS, then just-in-time provisions the matching app user. The user's role is
 * derived entirely from the token's realm roles (the `super` role); role
 * assignment is managed in Keycloak.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { extractTokenFromHeader } from '../utils/jwt.js';
import { upsertKeycloakUser } from '../db/users.js';

const KEYCLOAK_ISSUER =
  process.env.KEYCLOAK_ISSUER || 'http://localhost:8081/realms/dashboard';

// Expected token audience (the client this API trusts). When set, tokens minted
// for a *different* client in the same realm are rejected. Left blank, only the
// issuer is checked (set KEYCLOAK_AUDIENCE in production — see .env.example).
const KEYCLOAK_AUDIENCE = process.env.KEYCLOAK_AUDIENCE || '';

// Verification options shared by every token check.
const VERIFY_OPTIONS = { issuer: KEYCLOAK_ISSUER };
if (KEYCLOAK_AUDIENCE) VERIFY_OPTIONS.audience = KEYCLOAK_AUDIENCE;

// Remote JWKS — jose caches keys and refreshes on rotation.
const JWKS = createRemoteJWKSet(
  new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`)
);

/**
 * Verify a Keycloak access token and resolve it to an app user.
 * @returns {Promise<Object>} req.user shape
 */
async function resolveUserFromToken(token) {
  const { payload } = await jwtVerify(token, JWKS, VERIFY_OPTIONS);

  const email = payload.email || '';
  const roles = payload.realm_access?.roles || [];
  const role = roles.includes('super') ? 'super' : 'user';

  // JIT provision / link by Keycloak sub or email, keeping the stable app id.
  const user = await upsertKeycloakUser({
    sub: payload.sub,
    email,
    name: payload.name || payload.preferred_username || '',
    role,
  });

  // role from the token is authoritative for this request
  return { ...user, role };
}

/**
 * Authenticate: require a valid Keycloak token, attach the app user.
 */
export async function authenticateToken(req, res, next) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access token required',
      });
    }

    req.user = await resolveUserFromToken(token);
    next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Optional authentication: attach the user if a valid token is present,
 * but never fail the request if it's missing or invalid.
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    if (token) {
      req.user = await resolveUserFromToken(token);
    }
  } catch {
    // ignore — continue unauthenticated
  }
  next();
}

export default {
  authenticateToken,
  optionalAuth,
};
