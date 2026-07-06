/**
 * Authentication Routes
 *
 * Authentication is handled by Keycloak (OIDC). The frontend obtains tokens
 * directly from Keycloak; the backend only validates them (see middleware/auth)
 * and exposes the current user's profile.
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { password, ...userWithoutPassword } = req.user;
    res.json({
      status: 'success',
      data: {
        user: userWithoutPassword
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get profile'
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout (client clears its token; Keycloak session ended client-side)
 * @access  Private
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    message: 'Logged out successfully. Please remove token from client.'
  });
});

export default router;
