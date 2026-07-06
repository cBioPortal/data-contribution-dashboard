/**
 * User Management Routes
 * 
 * Admin routes for managing users (super users only)
 */

import express from 'express';
import { body, validationResult } from 'express-validator';
import {
  getAllUsers,
  findUserById,
  updateUserRole,
  deleteUser
} from '../db/users.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireSuper } from '../middleware/roleCheck.js';

const router = express.Router();

/**
 * All routes in this file require super user privileges
 */
router.use(authenticateToken, requireSuper);

/**
 * GET /api/users
 * Get all users
 * Super users only
 */
router.get('/', async (req, res) => {
  try {
    const users = await getAllUsers();
    
    res.json({
      status: 'success',
      data: {
        users,
        count: users.length
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users'
    });
  }
});

/**
 * GET /api/users/:id
 * Get user by ID
 * Super users only
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await findUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Remove password
    const { password, ...userWithoutPassword } = user;
    
    res.json({
      status: 'success',
      data: {
        user: userWithoutPassword
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user'
    });
  }
});

/**
 * PUT /api/users/:id/role
 * Change user role
 * Super users only
 */
router.put('/:id/role',
  body('role').isIn(['user', 'super']).withMessage('Role must be user or super'),
  
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const { role } = req.body;
      
      // Prevent users from removing their own super privileges
      if (req.params.id === req.user.id && role !== 'super') {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot remove your own super user privileges'
        });
      }
      
      const updatedUser = await updateUserRole(req.params.id, role);
      
      res.json({
        status: 'success',
        message: 'User role updated successfully',
        data: {
          user: updatedUser
        }
      });
    } catch (error) {
      console.error('Change role error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }
      
      res.status(500).json({
        status: 'error',
        message: 'Failed to update user role'
      });
    }
  }
);

/**
 * DELETE /api/users/:id
 * Delete user
 * Super users only
 */
router.delete('/:id', async (req, res) => {
  try {
    // Prevent users from deleting themselves
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete your own account'
      });
    }
    
    await deleteUser(req.params.id);
    
    res.json({
      status: 'success',
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);

    res.status(500).json({
      status: 'error',
      message: 'Failed to delete user'
    });
  }
});

export default router;
