import Notification from '../models/Notification.js';
import BrokerDetail from '../models/BrokerDetail.js';
import User from '../models/User.js';

/**
 * Helper function to create notifications
 * @param {Object} options - Notification options
 * @param {String|ObjectId} options.userId - User ID who will receive the notification
 * @param {String} options.type - Notification type: 'lead', 'property', 'message', 'system', 'transfer', 'approval', 'other'
 * @param {String} options.title - Notification title
 * @param {String} options.message - Notification message
 * @param {String} options.priority - Priority: 'low', 'medium', 'high' (default: 'medium')
 * @param {Object} options.relatedEntity - Related entity info { entityType, entityId }
 * @param {Object} options.activity - Activity info { action, actorId, actorName }
 * @param {Object} options.metadata - Additional metadata
 * @returns {Promise<Notification>} Created notification
 */
export const createNotification = async ({
  userId,
  type,
  title,
  message,
  priority = 'medium',
  relatedEntity = null,
  activity = null,
  metadata = {}
}) => {
  try {
    const notification = new Notification({
      userId,
      type,
      title,
      message,
      priority,
      relatedEntity,
      activity,
      metadata
    });

    await notification.save();
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw - notifications shouldn't break main flow
    return null;
  }
};

/**
 * Create notification for a broker by BrokerDetail ID
 * Finds the broker's userId and creates notification
 */
export const createNotificationForBroker = async (brokerDetailId, notificationData) => {
  try {
    const broker = await BrokerDetail.findById(brokerDetailId).select('userId');
    if (!broker || !broker.userId) {
      console.warn(`BrokerDetail ${brokerDetailId} not found or has no userId`);
      return null;
    }

    return await createNotification({
      ...notificationData,
      userId: broker.userId
    });
  } catch (error) {
    console.error('Error creating notification for broker:', error);
    return null;
  }
};

/**
 * Create notifications for multiple brokers
 */
export const createNotificationsForBrokers = async (brokerDetailIds, notificationData) => {
  try {
    const brokers = await BrokerDetail.find({
      _id: { $in: brokerDetailIds }
    }).select('userId');

    const notifications = await Promise.all(
      brokers
        .filter(b => b.userId)
        .map(broker =>
          createNotification({
            ...notificationData,
            userId: broker.userId
          })
        )
    );

    return notifications.filter(n => n !== null);
  } catch (error) {
    console.error('Error creating notifications for brokers:', error);
    return [];
  }
};

/**
 * Create notification for lead events
 */
export const createLeadNotification = async (userId, action, lead, actor = null) => {
  // Get customer name (handle both object and populated cases)
  const customerName = lead.customerName || 'Unknown Customer';
  const customerPhone = lead.customerPhone || '';
  const requirement = lead.requirement || '';
  
  const actionMessages = {
    created: `New lead created for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}${requirement ? ` - ${requirement.substring(0, 50)}${requirement.length > 50 ? '...' : ''}` : ''}`,
    updated: `Lead updated for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}`,
    transferred: `Lead for ${customerName}${customerPhone ? ` (${customerPhone})` : ''} has been transferred to you`,
    statusChanged: `Lead status changed for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}${lead.status ? ` to ${lead.status}` : ''}`,
    deleted: `Lead deleted for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}`
  };

  const titles = {
    created: `New Lead: ${customerName}`,
    updated: `Lead Updated: ${customerName}`,
    transferred: `Lead Transferred: ${customerName}`,
    statusChanged: `Lead Status Changed: ${customerName}`,
    deleted: `Lead Deleted: ${customerName}`
  };

  return await createNotification({
    userId,
    type: 'lead',
    title: titles[action] || `Lead Activity: ${customerName}`,
    message: actionMessages[action] || `Lead activity for ${customerName}: ${action}`,
    priority: action === 'transferred' ? 'high' : 'medium',
    relatedEntity: {
      entityType: 'Lead',
      entityId: lead._id || lead
    },
    activity: actor ? {
      action,
      actorId: actor._id || actor,
      actorName: actor.name || actor.name
    } : { action },
    metadata: {
      leadId: lead._id || lead,
      customerName,
      customerPhone,
      requirement,
      status: lead.status
    }
  });
};

/**
 * Create notification for property events
 */
export const createPropertyNotification = async (userId, action, property, actor = null) => {
  // Get property details (handle both object and populated cases)
  const propertyTitle = property.title || property.propertyTitle || 'Unknown Property';
  const propertyAddress = property.address || '';
  const bedrooms = property.bedrooms || property.bedroom;
  const propertyType = property.propertyType || '';
  const subType = property.subType || '';
  const price = property.price;
  const priceUnit = property.priceUnit || 'INR';
  
  // Build property description
  let propertyDesc = '';
  if (bedrooms) {
    propertyDesc = `${bedrooms} BHK`;
  }
  if (subType) {
    propertyDesc = propertyDesc ? `${propertyDesc} ${subType}` : subType;
  } else if (propertyType) {
    propertyDesc = propertyDesc ? `${propertyDesc} ${propertyType}` : propertyType;
  }
  if (!propertyDesc) {
    propertyDesc = propertyTitle;
  }
  
  // Format price
  let priceText = '';
  if (price) {
    const formattedPrice = new Intl.NumberFormat('en-IN').format(price);
    priceText = ` (₹${formattedPrice}${priceUnit !== 'INR' ? ` ${priceUnit}` : ''})`;
  }
  
  const actionMessages = {
    created: `Property created: ${propertyTitle}${priceText}${propertyAddress ? ` at ${propertyAddress}` : ''}`,
    updated: `Property updated: ${propertyTitle}${priceText}${propertyAddress ? ` at ${propertyAddress}` : ''}`,
    approved: `Your property "${propertyTitle}"${priceText}${propertyAddress ? ` at ${propertyAddress}` : ''} has been approved`,
    rejected: `Your property "${propertyTitle}"${priceText}${propertyAddress ? ` at ${propertyAddress}` : ''} has been rejected`,
    deleted: `Property deleted: ${propertyTitle}${priceText}${propertyAddress ? ` at ${propertyAddress}` : ''}`
  };

  const titles = {
    created: `Property Created: ${propertyTitle}`,
    updated: `Property Updated: ${propertyTitle}`,
    approved: `Property Approved: ${propertyTitle}`,
    rejected: `Property Rejected: ${propertyTitle}`,
    deleted: `Property Deleted: ${propertyTitle}`
  };

  return await createNotification({
    userId,
    type: 'property',
    title: titles[action] || `Property Activity: ${propertyTitle}`,
    message: actionMessages[action] || `Property activity for ${propertyTitle}: ${action}`,
    priority: action === 'approved' || action === 'rejected' ? 'high' : 'medium',
    relatedEntity: {
      entityType: 'Property',
      entityId: property._id || property
    },
    activity: actor ? {
      action,
      actorId: actor._id || actor,
      actorName: actor.name || actor.name
    } : { action },
    metadata: {
      propertyId: property._id || property,
      title: propertyTitle,
      address: propertyAddress,
      bedrooms,
      propertyType,
      subType,
      price,
      priceUnit,
      status: property.status
    }
  });
};

/**
 * Create notification for transfer events
 */
export const createTransferNotification = async (toBrokerId, fromBrokerId, lead, actor = null) => {
  try {
    // Get broker details for actor name
    let actorName = null;
    if (actor) {
      actorName = actor.name;
    } else if (fromBrokerId) {
      const fromBroker = await BrokerDetail.findById(fromBrokerId)
        .populate('userId', 'name')
        .select('name userId');
      actorName = fromBroker?.name || fromBroker?.userId?.name || 'Unknown Broker';
    }

    return await createNotificationForBroker(toBrokerId, {
      type: 'transfer',
      title: 'Lead Transferred to You',
      message: `A lead for ${lead.customerName || 'customer'} has been transferred to you${actorName ? ` by ${actorName}` : ''}`,
      priority: 'high',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: {
        action: 'transferred',
        actorId: actor?._id || actor,
        actorName
      },
      metadata: {
        leadId: lead._id || lead,
        fromBrokerId,
        toBrokerId,
        customerName: lead.customerName,
        customerPhone: lead.customerPhone
      }
    });
  } catch (error) {
    console.error('Error creating transfer notification:', error);
    return null;
  }
};

