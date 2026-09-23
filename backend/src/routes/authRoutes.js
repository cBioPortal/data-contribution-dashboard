/**
 * Authentication Routes
 *
 * Authentication is handled by Keycloak (OIDC). The frontend obtains tokens
 * directly from Keycloak; the backend only validates them (see middleware/auth)
 * and exposes the current user's profile.
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getCurationTeamWorkspace,
  listActiveCurationsForUser,
  listCompletedCurationsForUser,
  listUserNotifications,
  markUserNotificationRead,
} from '../db/curationVolunteers.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { password, ...userWithoutPassword } = req.user;
    const isSuper = req.user.role === 'super';
    const [activeCurations, completedCurations, notifications, teamWorkspace] = await Promise.all([
      isSuper ? Promise.resolve([]) : listActiveCurationsForUser(req.user.id),
      isSuper ? Promise.resolve([]) : listCompletedCurationsForUser(req.user.id),
      listUserNotifications(req.user.id),
      isSuper ? getCurationTeamWorkspace(req.user.id) : Promise.resolve(null),
    ]);
    res.json({
      status: 'success',
      data: {
        user: userWithoutPassword,
        activeAssignments: {
          count: activeCurations.length,
          studies: activeCurations,
        },
        contributions: {
          completedCurations: completedCurations.length,
          studies: completedCurations,
        },
        notifications: {
          unreadCount: notifications.unreadCount,
          items: notifications.items,
        },
        teamWorkspace,
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get profile'
    });
  }
});

router.patch('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const updated = await markUserNotificationRead(req.params.notificationId, req.user.id);
    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Notification not found' });
    }
    res.json({ status: 'success' });
  } catch (error) {
    logger.error('Mark notification read error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update notification' });
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
