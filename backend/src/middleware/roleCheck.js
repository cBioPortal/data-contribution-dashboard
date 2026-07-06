/**
 * Role Check Middleware
 * 
 * Verify user roles and permissions
 */

/**
 * Require super user role
 * Must be used after authenticateToken middleware
 */
export function requireSuper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }

  // Guest users cannot be super users
  if (req.user.isTemporary || req.user.role !== 'super') {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Super user privileges required.'
    });
  }

  next();
}

/**
 * Require user to be authenticated (any role)
 * Just an alias for better code readability
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required'
    });
  }
  next();
}

/**
 * Check if user owns the resource or is a super user
 * @param {Function} getResourceUserId - Function that returns resource's userId
 */
export function requireOwnerOrSuper(getResourceUserId) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required'
      });
    }

    // Super users can access anything
    if (req.user.role === 'super') {
      return next();
    }

    // Get the resource's owner ID
    const resourceUserId = await getResourceUserId(req);
    
    if (req.user.id !== resourceUserId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. You can only access your own resources.'
      });
    }

    next();
  };
}

export default {
  requireSuper,
  requireAuth,
  requireOwnerOrSuper
};
