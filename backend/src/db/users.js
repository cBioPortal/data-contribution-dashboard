/**
 * User Database Operations (Postgres)
 *
 * CRUD operations for user management.
 * OAuth-only authentication (no passwords).
 */

import { query } from './index.js';
import { v4 as uuidv4 } from 'uuid';

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** Map a DB row to the camelCase user shape the app expects. */
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    institution: row.institution,
    role: row.role,
    provider: row.provider,
    providerId: row.provider_id,
    createdAt: toIso(row.created_at),
    lastLogin: toIso(row.last_login),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Create a new user (OAuth only)
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user
 */
export async function createUser(userData) {
  const userId = `user_${uuidv4()}`;
  const { rows } = await query(
    `INSERT INTO users (id, email, name, institution, role, provider, provider_id, last_login)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [
      userId,
      userData.email.toLowerCase(),
      userData.name || '',
      userData.institution || '',
      userData.role || 'user',
      userData.provider,
      userData.providerId,
    ]
  );
  return rowToUser(rows[0]);
}

/**
 * Find user by email (case-insensitive)
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export async function findUserByEmail(email) {
  const { rows } = await query(
    'SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1',
    [email]
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

/**
 * Find user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
export async function findUserById(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows.length ? rowToUser(rows[0]) : null;
}

/**
 * Find user by provider ID (for OAuth)
 * @param {string} provider - Provider name ('google', 'github')
 * @param {string} providerId - Provider's user ID
 * @returns {Promise<Object|null>} User object or null
 */
export async function findUserByProviderId(provider, providerId) {
  const { rows } = await query(
    'SELECT * FROM users WHERE provider = $1 AND provider_id = $2 LIMIT 1',
    [provider, providerId]
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

// Fields a caller is permitted to update, mapped to their column names.
const UPDATABLE_COLUMNS = {
  email: 'email',
  name: 'name',
  institution: 'institution',
  role: 'role',
  lastLogin: 'last_login',
};

/**
 * Update user. Only known, permitted fields are applied; id/provider/createdAt
 * are immutable (matching the previous LevelDB behaviour).
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated user
 */
export async function updateUser(userId, updates) {
  const sets = [];
  const values = [];
  let i = 1;

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (updates[key] !== undefined) {
      let val = updates[key];
      if (key === 'email' && typeof val === 'string') val = val.toLowerCase();
      sets.push(`${column} = $${i++}`);
      values.push(val);
    }
  }

  sets.push('updated_at = now()');
  values.push(userId);

  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!rows.length) throw new Error('User not found');
  return rowToUser(rows[0]);
}

/**
 * Update user's last login time
 * @param {string} userId - User ID
 */
export async function updateLastLogin(userId) {
  await query(
    'UPDATE users SET last_login = now(), updated_at = now() WHERE id = $1',
    [userId]
  );
}

/**
 * Delete user
 * @param {string} userId - User ID
 */
export async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * Get all users (admin only)
 * @returns {Promise<Array>} Array of users
 */
export async function getAllUsers() {
  const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(rowToUser);
}

/**
 * Update user role
 * @param {string} userId - User ID
 * @param {string} role - New role ('user' or 'super')
 */
export async function updateUserRole(userId, role) {
  if (!['user', 'super'].includes(role)) {
    throw new Error('Invalid role. Must be "user" or "super"');
  }
  return updateUser(userId, { role });
}

/**
 * Find a user by their Keycloak subject id.
 */
export async function findUserByKeycloakSub(sub) {
  const { rows } = await query('SELECT * FROM users WHERE keycloak_sub = $1 LIMIT 1', [sub]);
  return rows.length ? rowToUser(rows[0]) : null;
}

/**
 * Just-in-time provision a user from Keycloak token claims.
 * Resolution order: (1) match by keycloak_sub, (2) link an existing row by
 * email, (3) create a new user. Keeps the stable app `user_<uuid>` id so the
 * submissions.user_id linkage is preserved across the auth migration.
 *
 * @param {{sub:string, email?:string, name?:string, role:'user'|'super'}} claims
 * @returns {Promise<Object>} the app user (camelCase)
 */
export async function upsertKeycloakUser({ sub, email, name, role }) {
  const normEmail = (email || '').toLowerCase();

  // 1. Already linked by Keycloak sub
  let { rows } = await query('SELECT * FROM users WHERE keycloak_sub = $1 LIMIT 1', [sub]);
  if (rows.length) {
    const res = await query(
      `UPDATE users SET email = COALESCE($2, email), name = COALESCE($3, name),
         role = $4, last_login = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [rows[0].id, normEmail || null, name || null, role]
    );
    return rowToUser(res.rows[0]);
  }

  // 2. Existing app user with the same email — link it to this Keycloak identity
  if (normEmail) {
    ({ rows } = await query(
      'SELECT * FROM users WHERE lower(email) = $1 ORDER BY last_login DESC NULLS LAST LIMIT 1',
      [normEmail]
    ));
    if (rows.length) {
      const res = await query(
        `UPDATE users SET keycloak_sub = $2, name = COALESCE($3, name), role = $4,
           last_login = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [rows[0].id, sub, name || null, role]
      );
      return rowToUser(res.rows[0]);
    }
  }

  // 3. Brand-new user
  const id = `user_${uuidv4()}`;
  const res = await query(
    `INSERT INTO users (id, email, name, role, keycloak_sub, last_login)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
    [id, normEmail, name || '', role, sub]
  );
  return rowToUser(res.rows[0]);
}

export default {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByProviderId,
  findUserByKeycloakSub,
  upsertKeycloakUser,
  updateUser,
  updateLastLogin,
  deleteUser,
  getAllUsers,
  updateUserRole,
};
