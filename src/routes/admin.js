import express from 'express';
import { getAdminDashboardStats } from '../controllers/adminDashboardController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Admin dashboard routes - protected with admin authorization
router.get('/dashboard/stats', authenticate, authorize('admin'), getAdminDashboardStats);

export default router;

