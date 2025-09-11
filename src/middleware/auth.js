import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { errorResponse } from '../utils/response.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return errorResponse(res, 'Access denied. No token provided.', 401);
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-passwordHash');
    
    if (!user) {
      return errorResponse(res, 'Invalid token. User not found.', 401);
    }

    if (user.status === 'suspended') {
      return errorResponse(res, 'Account suspended. Please contact admin.', 403);
    }

    req.user = user;
    next();
  } catch (error) {
    return errorResponse(res, 'Invalid token.', 401);
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Access denied. Please authenticate first.', 401);
    }

    if (!roles.includes(req.user.role)) {
      return errorResponse(res, 'Access denied. Insufficient permissions.', 403);
    }

    next();
  };
};

export const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return errorResponse(res, 'Please verify your email address first.', 403);
  }
  next();
};

export const requirePhoneVerification = (req, res, next) => {
  if (!req.user.isPhoneVerified) {
    return errorResponse(res, 'Please verify your phone number first.', 403);
  }
  next();
};



