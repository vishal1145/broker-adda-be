import Notification from '../models/Notification.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

/**
 * Get all notifications for the authenticated user
 * Supports pagination and filtering
 */
export const getAllNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      page = 1, 
      limit = 20, 
      isRead, 
      type,
      priority 
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { userId };

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    if (type) {
      query.type = type;
    }

    if (priority) {
      query.priority = priority;
    }

    // Get notifications with pagination
    const notifications = await Notification.find(query)
      .populate('userId', 'name email phone role')
      .populate('relatedEntity.entityId')
      .populate('activity.actorId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalNotifications = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ 
      userId, 
      isRead: false 
    });

    return successResponse(res, 'Notifications retrieved successfully', {
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalNotifications / parseInt(limit)),
        totalNotifications,
        hasNextPage: parseInt(page) < Math.ceil(totalNotifications / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      },
      unreadCount
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Get recent activity notifications
 * Returns notifications from the last N days (default: 7 days)
 */
export const getRecentActivityNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      days = 7, 
      limit = 50,
      type 
    } = req.query;

    // Calculate date threshold
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    // Build query
    const query = {
      userId,
      createdAt: { $gte: daysAgo }
    };

    if (type) {
      query.type = type;
    }

    // Get recent notifications
    const notifications = await Notification.find(query)
      .populate('userId', 'name email phone role')
      .populate('relatedEntity.entityId')
      .populate('activity.actorId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Get counts by type
    const countsByType = await Notification.aggregate([
      {
        $match: {
          userId: userId,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get unread count for recent period
    const unreadCount = await Notification.countDocuments({
      userId,
      isRead: false,
      createdAt: { $gte: daysAgo }
    });

    return successResponse(res, 'Recent activity notifications retrieved successfully', {
      notifications,
      summary: {
        totalNotifications: notifications.length,
        unreadCount,
        daysPeriod: parseInt(days),
        countsByType: countsByType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notificationId } = req.params;

    const notification = await Notification.findOne({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    notification.isRead = true;
    await notification.save();

    return successResponse(res, 'Notification marked as read', {
      notification
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Mark all notifications as read for the user
 */
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    );

    return successResponse(res, 'All notifications marked as read', {
      updatedCount: result.modifiedCount
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Delete a notification
 */
export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    return successResponse(res, 'Notification deleted successfully', {
      notification
    });

  } catch (error) {
    return serverError(res, error);
  }
};

