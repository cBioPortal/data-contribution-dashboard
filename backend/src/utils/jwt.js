/**
 * Token Utility Functions
 *
 * The backend no longer issues its own JWTs — authentication is delegated to
 * Keycloak (validated in middleware/auth via JWKS). This module retains only
 * the helper for pulling the bearer token off the Authorization header.
 */

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null
 */
export function extractTokenFromHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove 'Bearer ' prefix
}

export default {
  extractTokenFromHeader,
};
