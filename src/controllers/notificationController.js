import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import BrokerDetail from '../models/BrokerDetail.js';
import CustomerDetail from '../models/CustomerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { createNotification } from '../utils/notifications.js';

/**
 * Get all notifications for the authenticated user
 * Supports pagination and filtering by type, entityType, isRead
 */
export const getAllNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      page = 1, 
      limit = 20, 
      isRead, 
      type, // Filter by notification type: 'lead', 'property', 'message', 'system', 'transfer', 'approval', 'other'
      entityType, // Filter by related entity type: 'Lead', 'Property', 'Message', 'Chat', 'BrokerDetail', 'CustomerDetail'
      entityId // Filter by specific entity ID
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

    if (entityType) {
      query['relatedEntity.entityType'] = entityType;
    }

    if (entityId) {
      query['relatedEntity.entityId'] = entityId;
    }

    // Get notifications with pagination
    let notifications = await Notification.find(query)
      .populate('userId', 'name email phone role')
      .populate('activity.actorId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Populate related entities based on entityType
    notifications = await Promise.all(notifications.map(async (notification) => {
      const notificationObj = notification.toObject();
      
      if (notification.relatedEntity?.entityId && notification.relatedEntity?.entityType) {
        try {
          switch (notification.relatedEntity.entityType) {
            case 'Lead':
              notificationObj.relatedEntity.entity = await Lead.findById(notification.relatedEntity.entityId)
                .populate('createdBy', 'name email phone')
                .populate('primaryRegion', 'name city state')
                .populate('secondaryRegion', 'name city state');
              break;
            case 'Property':
              notificationObj.relatedEntity.entity = await Property.findById(notification.relatedEntity.entityId)
                .populate('broker', 'name email phone')
                .populate('region', 'name city state');
              break;
            case 'BrokerDetail':
              notificationObj.relatedEntity.entity = await BrokerDetail.findById(notification.relatedEntity.entityId)
                .populate('userId', 'name email phone role');
              break;
            case 'CustomerDetail':
              notificationObj.relatedEntity.entity = await CustomerDetail.findById(notification.relatedEntity.entityId)
                .populate('userId', 'name email phone role');
              break;
            default:
              notificationObj.relatedEntity.entity = notification.relatedEntity.entityId;
          }
        } catch (err) {
          console.error('Error populating related entity:', err);
          notificationObj.relatedEntity.entity = null;
        }
      }
      
      return notificationObj;
    }));

    // Get total count
    const totalNotifications = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ 
      userId, 
      isRead: false 
    });

    // Get counts by type
    const countsByType = await Notification.aggregate([
      { $match: { userId: userId } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          unreadCount: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          }
        }
      }
    ]);

    return successResponse(res, 'Notifications retrieved successfully', {
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalNotifications / parseInt(limit)),
        totalNotifications,
        hasNextPage: parseInt(page) < Math.ceil(totalNotifications / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      },
      unreadCount,
      countsByType: countsByType.reduce((acc, item) => {
        acc[item._id] = {
          total: item.count,
          unread: item.unreadCount
        };
        return acc;
      }, {})
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Get recent activity notifications
 * Returns notifications from the last N days (default: 7 days)
 * Supports filtering by type and entityType
 */
export const getRecentActivityNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      days = 7, 
      limit = 50,
      type, // Filter by notification type
      entityType // Filter by related entity type
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

    if (entityType) {
      query['relatedEntity.entityType'] = entityType;
    }

    // Get recent notifications
    let notifications = await Notification.find(query)
      .populate('userId', 'name email phone role')
      .populate('activity.actorId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Populate related entities based on entityType
    notifications = await Promise.all(notifications.map(async (notification) => {
      const notificationObj = notification.toObject();
      
      if (notification.relatedEntity?.entityId && notification.relatedEntity?.entityType) {
        try {
          switch (notification.relatedEntity.entityType) {
            case 'Lead':
              notificationObj.relatedEntity.entity = await Lead.findById(notification.relatedEntity.entityId)
                .populate('createdBy', 'name email phone')
                .populate('primaryRegion', 'name city state')
                .populate('secondaryRegion', 'name city state');
              break;
            case 'Property':
              notificationObj.relatedEntity.entity = await Property.findById(notification.relatedEntity.entityId)
                .populate('broker', 'name email phone')
                .populate('region', 'name city state');
              break;
            case 'BrokerDetail':
              notificationObj.relatedEntity.entity = await BrokerDetail.findById(notification.relatedEntity.entityId)
                .populate('userId', 'name email phone role');
              break;
            case 'CustomerDetail':
              notificationObj.relatedEntity.entity = await CustomerDetail.findById(notification.relatedEntity.entityId)
                .populate('userId', 'name email phone role');
              break;
            default:
              notificationObj.relatedEntity.entity = notification.relatedEntity.entityId;
          }
        } catch (err) {
          console.error('Error populating related entity:', err);
          notificationObj.relatedEntity.entity = null;
        }
      }
      
      return notificationObj;
    }));

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
          count: { $sum: 1 },
          unreadCount: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          }
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
          acc[item._id] = {
            total: item.count,
            unread: item.unreadCount
          };
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

/**
 * Admin: Get all notifications across all users
 * Supports pagination and filtering
 */
export const adminGetAllNotifications = async (req, res) => {
  try {

    const { 
      page = 1, 
      limit = 50, 
      isRead, 
      type,
      entityType,
      userId, // Filter by specific user
      days // Filter by days (recent notifications)
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};

    if (userId) {
      query.userId = userId;
    }

    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      query.createdAt = { $gte: daysAgo };
    }

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    if (type) {
      query.type = type;
    }

    if (entityType) {
      query['relatedEntity.entityType'] = entityType;
    }

    // Get notifications with pagination - only essential fields
    let notifications = await Notification.find(query)
      .populate('userId', 'name role')
      .populate('activity.actorId', 'name')
      .select('type title message isRead relatedEntity activity createdAt userId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Populate only essential related entity fields
    notifications = await Promise.all(notifications.map(async (notification) => {
      const notificationObj = notification.toObject();
      
      // Clean up user data - only keep essential fields
      if (notificationObj.userId) {
        notificationObj.user = {
          _id: notificationObj.userId._id,
          name: notificationObj.userId.name,
          role: notificationObj.userId.role
        };
        delete notificationObj.userId;
      }

      // Clean up activity actor data
      if (notificationObj.activity?.actorId) {
        notificationObj.activity.actor = {
          _id: notificationObj.activity.actorId._id,
          name: notificationObj.activity.actorId.name
        };
        delete notificationObj.activity.actorId;
      }
      
      // Populate only essential entity fields
      if (notification.relatedEntity?.entityId && notification.relatedEntity?.entityType) {
        try {
          switch (notification.relatedEntity.entityType) {
            case 'Lead':
              const lead = await Lead.findById(notification.relatedEntity.entityId)
                .select('customerName customerPhone requirement propertyType budget status')
                .lean();
              notificationObj.relatedEntity.entity = lead ? {
                _id: lead._id,
                customerName: lead.customerName,
                customerPhone: lead.customerPhone,
                requirement: lead.requirement,
                propertyType: lead.propertyType,
                budget: lead.budget,
                status: lead.status
              } : null;
              break;
            case 'Property':
              const property = await Property.findById(notification.relatedEntity.entityId)
                .select('title propertyType price address city status')
                .lean();
              notificationObj.relatedEntity.entity = property ? {
                _id: property._id,
                title: property.title,
                propertyType: property.propertyType,
                price: property.price,
                address: property.address,
                city: property.city,
                status: property.status
              } : null;
              break;
            case 'BrokerDetail':
              const broker = await BrokerDetail.findById(notification.relatedEntity.entityId)
                .select('name email phone firmName status')
                .lean();
              notificationObj.relatedEntity.entity = broker ? {
                _id: broker._id,
                name: broker.name,
                email: broker.email,
                phone: broker.phone,
                firmName: broker.firmName,
                status: broker.status
              } : null;
              break;
            case 'CustomerDetail':
              const customer = await CustomerDetail.findById(notification.relatedEntity.entityId)
                .select('name email phone')
                .lean();
              notificationObj.relatedEntity.entity = customer ? {
                _id: customer._id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone
              } : null;
              break;
            default:
              notificationObj.relatedEntity.entity = {
                _id: notification.relatedEntity.entityId
              };
          }
        } catch (err) {
          console.error('Error populating related entity:', err);
          notificationObj.relatedEntity.entity = null;
        }
      }
      
      // Return only essential notification fields
      return {
        _id: notificationObj._id,
        type: notificationObj.type,
        title: notificationObj.title,
        message: notificationObj.message,
        isRead: notificationObj.isRead,
        createdAt: notificationObj.createdAt,
        user: notificationObj.user,
        relatedEntity: notificationObj.relatedEntity,
        activity: notificationObj.activity
      };
    }));

    // Get total count
    const totalNotifications = await Notification.countDocuments(query);

    // Get statistics - simplified
    const stats = await Notification.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          }
        }
      }
    ]);

    return successResponse(res, 'All notifications retrieved successfully', {
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalNotifications / parseInt(limit)),
        totalNotifications,
        hasNextPage: parseInt(page) < Math.ceil(totalNotifications / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      },
      summary: {
        total: stats[0]?.total || 0,
        unread: stats[0]?.unread || 0
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Admin: Get recent activity notifications across all users
 */
export const adminGetRecentActivity = async (req, res) => {
  try {

    const { 
      days = 7, 
      limit = 100,
      type,
      entityType,
      userId // Filter by specific user
    } = req.query;

    // Calculate date threshold
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    // Build query
    const query = {
      createdAt: { $gte: daysAgo }
    };

    if (userId) {
      query.userId = userId;
    }

    if (type) {
      query.type = type;
    }

    if (entityType) {
      query['relatedEntity.entityType'] = entityType;
    }

    // Get recent notifications - only essential fields
    let notifications = await Notification.find(query)
      .populate('userId', 'name role')
      .populate('activity.actorId', 'name')
      .select('type title message isRead relatedEntity activity createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Populate only essential related entity fields
    notifications = await Promise.all(notifications.map(async (notification) => {
      const notificationObj = notification.toObject();
      
      // Clean up user data - only keep essential fields
      if (notificationObj.userId) {
        notificationObj.user = {
          _id: notificationObj.userId._id,
          name: notificationObj.userId.name,
          role: notificationObj.userId.role
        };
        delete notificationObj.userId;
      }

      // Clean up activity actor data
      if (notificationObj.activity?.actorId) {
        notificationObj.activity.actor = {
          _id: notificationObj.activity.actorId._id,
          name: notificationObj.activity.actorId.name
        };
        delete notificationObj.activity.actorId;
      }
      
      // Populate only essential entity fields
      if (notification.relatedEntity?.entityId && notification.relatedEntity?.entityType) {
        try {
          switch (notification.relatedEntity.entityType) {
            case 'Lead':
              const lead = await Lead.findById(notification.relatedEntity.entityId)
                .select('customerName customerPhone requirement propertyType budget status')
                .lean();
              notificationObj.relatedEntity.entity = lead ? {
                _id: lead._id,
                customerName: lead.customerName,
                customerPhone: lead.customerPhone,
                requirement: lead.requirement,
                propertyType: lead.propertyType,
                budget: lead.budget,
                status: lead.status
              } : null;
              break;
            case 'Property':
              const property = await Property.findById(notification.relatedEntity.entityId)
                .select('title propertyType price address city status')
                .lean();
              notificationObj.relatedEntity.entity = property ? {
                _id: property._id,
                title: property.title,
                propertyType: property.propertyType,
                price: property.price,
                address: property.address,
                city: property.city,
                status: property.status
              } : null;
              break;
            case 'BrokerDetail':
              const broker = await BrokerDetail.findById(notification.relatedEntity.entityId)
                .select('name email phone firmName status')
                .lean();
              notificationObj.relatedEntity.entity = broker ? {
                _id: broker._id,
                name: broker.name,
                email: broker.email,
                phone: broker.phone,
                firmName: broker.firmName,
                status: broker.status
              } : null;
              break;
            case 'CustomerDetail':
              const customer = await CustomerDetail.findById(notification.relatedEntity.entityId)
                .select('name email phone')
                .lean();
              notificationObj.relatedEntity.entity = customer ? {
                _id: customer._id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone
              } : null;
              break;
            default:
              notificationObj.relatedEntity.entity = {
                _id: notification.relatedEntity.entityId
              };
          }
        } catch (err) {
          console.error('Error populating related entity:', err);
          notificationObj.relatedEntity.entity = null;
        }
      }
      
      // Return only essential notification fields
      return {
        _id: notificationObj._id,
        type: notificationObj.type,
        title: notificationObj.title,
        message: notificationObj.message,
        isRead: notificationObj.isRead,
        createdAt: notificationObj.createdAt,
        user: notificationObj.user,
        relatedEntity: notificationObj.relatedEntity,
        activity: notificationObj.activity
      };
    }));

    // Get statistics - simplified
    const stats = await Notification.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          }
        }
      }
    ]);

    return successResponse(res, 'Recent activity retrieved successfully', {
      notifications,
      summary: {
        totalNotifications: stats[0]?.total || 0,
        unreadCount: stats[0]?.unread || 0,
        daysPeriod: parseInt(days)
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Admin: Mark all notifications as read
 * Supports filtering by type, entityType, userId, days
 */
export const adminMarkAllAsRead = async (req, res) => {
  try {
    const { 
      type,
      entityType,
      userId,
      days // Filter by days (recent notifications)
    } = req.query;

    // Build query - only unread notifications
    const query = { isRead: false };

    if (userId) {
      query.userId = userId;
    }

    if (type) {
      query.type = type;
    }

    if (entityType) {
      query['relatedEntity.entityType'] = entityType;
    }

    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      query.createdAt = { $gte: daysAgo };
    }

    // Mark all matching notifications as read
    const result = await Notification.updateMany(
      query,
      { $set: { isRead: true } }
    );

    return successResponse(res, 'All notifications marked as read', {
      updatedCount: result.modifiedCount,
      filters: {
        type: type || 'all',
        entityType: entityType || 'all',
        userId: userId || 'all',
        days: days || 'all'
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Update notification preferences (emailNotification, smsNotification, pushNotification)
 * Sends confirmation notification via enabled channels
 */
export const updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user._id;
    const { emailNotification, smsNotification, pushNotification } = req.body;

    // Get current user preferences
    const user = await User.findById(userId).select('email phone emailNotification smsNotification pushNotification');
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Track what changed
    const changes = [];
    const updateData = {};

    if (emailNotification !== undefined && typeof emailNotification === 'boolean') {
      if (user.emailNotification !== emailNotification) {
        updateData.emailNotification = emailNotification;
        changes.push(`Email notifications ${emailNotification ? 'enabled' : 'disabled'}`);
      }
    }

    if (smsNotification !== undefined && typeof smsNotification === 'boolean') {
      if (user.smsNotification !== smsNotification) {
        updateData.smsNotification = smsNotification;
        changes.push(`SMS notifications ${smsNotification ? 'enabled' : 'disabled'}`);
      }
    }

    if (pushNotification !== undefined && typeof pushNotification === 'boolean') {
      if (user.pushNotification !== pushNotification) {
        updateData.pushNotification = pushNotification;
        changes.push(`Push notifications ${pushNotification ? 'enabled' : 'disabled'}`);
      }
    }

    // If no changes, return early
    if (Object.keys(updateData).length === 0) {
      return successResponse(res, 'No changes detected', {
        preferences: {
          emailNotification: user.emailNotification,
          smsNotification: user.smsNotification,
          pushNotification: user.pushNotification
        }
      });
    }

    // Update user preferences
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, select: 'email phone emailNotification smsNotification pushNotification name' }
    );

    // Note: We do NOT send email/SMS confirmation when preferences are updated
    // Email/SMS are only sent for actual notifications (lead, property, message, etc.)
    // Preference updates are silent - just update the database

    return successResponse(res, 'Notification preferences updated successfully', {
      preferences: {
        emailNotification: updatedUser.emailNotification,
        smsNotification: updatedUser.smsNotification,
        pushNotification: updatedUser.pushNotification
      },
      changes: changes
    });

  } catch (error) {
    return serverError(res, error);
  }
};

