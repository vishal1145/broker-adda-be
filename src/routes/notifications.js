import express from 'express';
import {
  getAllNotifications,
  getRecentActivityNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  adminGetAllNotifications,
  adminGetRecentActivity,
  adminMarkAllAsRead,
  togglePushNotifications
} from '../controllers/notificationController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// User routes - Get all notifications with pagination and filters
// Query params: page, limit, isRead, type, entityType, entityId
// Example: /api/notifications?type=lead&entityType=Lead&isRead=false
router.get('/', getAllNotifications);

// User routes - Get recent activity notifications
// Query params: days, limit, type, entityType
// Example: /api/notifications/recent?days=7&type=lead
router.get('/recent', getRecentActivityNotifications);

// Mark notification as read
router.patch('/:notificationId/read', markNotificationAsRead);

// Mark all notifications as read
router.patch('/read-all', markAllNotificationsAsRead);

// Delete a notification
router.delete('/:notificationId', deleteNotification);

// Admin routes - Get all notifications across all users
// Query params: page, limit, isRead, type, entityType, userId, days
// Example: /api/notifications/admin/all?type=lead&entityType=Lead&days=30
router.get('/admin/all', authorize('admin'), adminGetAllNotifications);

// Admin routes - Get recent activity across all users
// Query params: days, limit, type, entityType, userId
// Example: /api/notifications/admin/recent?days=7&type=property
router.get('/admin/recent', authorize('admin'), adminGetRecentActivity);

// Admin routes - Mark all notifications as read (with filters)
// Query params: type, entityType, userId, days
// Example: /api/notifications/admin/read-all?type=lead&days=7
router.patch('/admin/read-all', authorize('admin'), adminMarkAllAsRead);

// Toggle push notifications on/off for authenticated user
// Body: { enable: true/false }
// If OFF: Notifications are hidden (not shown in GET API)
// If ON: All notifications are shown
router.patch('/push/toggle', togglePushNotifications);

export default router;

