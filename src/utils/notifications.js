import Notification from '../models/Notification.js';
import BrokerDetail from '../models/BrokerDetail.js';
import Property from '../models/Property.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import Lead from '../models/Lead.js';
import Message from '../models/Message.js';


const sendEmailNotification = async (userEmail, title, message) => {
  try {
    // Import nodemailer dynamically
    const nodemailer = await import('nodemailer');
    
    // Configure email transporter (you can move this to env variables)
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Only send if SMTP is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('Email not sent: SMTP not configured');
      return false;
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: userEmail,
      subject: title,
      text: message,
      html: `<p>${message}</p>`
    });

    return true;
  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
};


const sendSMSNotification = async (userPhone, message) => {
  try {
    // TODO: Integrate with SMS service provider (Twilio, AWS SNS, etc.)
    // For now, just log it
    console.log(`SMS to ${userPhone}: ${message}`);
    
    // Example with Twilio (uncomment and configure):
    // const twilio = require('twilio');
    // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // await client.messages.create({
    //   body: message,
    //   from: process.env.TWILIO_PHONE_NUMBER,
    //   to: userPhone
    // });
    
    return true;
  } catch (error) {
    console.error('Error sending SMS notification:', error);
    return false;
  }
};


const sendPushNotification = async (userId, title, message, metadata = {}) => {
  try {
  
    console.log(`Push notification to user ${userId}: ${title} - ${message}`);
    
    // Example with Firebase Cloud Messaging (uncomment and configure):
    // const admin = require('firebase-admin');
    // const message = {
    //   notification: {
    //     title: title,
    //     body: message
    //   },
    //   data: metadata,
    //   token: userFCMToken // Get from user's device tokens stored in database
    // };
    // await admin.messaging().send(message);
    
    // Example with OneSignal (uncomment and configure):
    // const OneSignal = require('onesignal-node');
    // const client = new OneSignal.Client(process.env.ONESIGNAL_APP_ID, process.env.ONESIGNAL_REST_API_KEY);
    // await client.createNotification({
    //   contents: { en: message },
    //   headings: { en: title },
    //   include_external_user_ids: [userId.toString()]
    // });
    
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
};


export const getUserIdFromBrokerOrProperty = async (brokerId = null, propertyId = null) => {
  try {
    if (brokerId) {
      const broker = await BrokerDetail.findById(brokerId).select('userId');
      if (broker?.userId) {
        return broker.userId._id || broker.userId;
      }
    }
    
    if (propertyId) {
      const property = await Property.findById(propertyId).select('broker');
      if (property?.broker) {
        const broker = await BrokerDetail.findById(property.broker).select('userId');
        if (broker?.userId) {
          return broker.userId._id || broker.userId;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting userId from broker/property:', error);
    return null;
  }
};

/**
 * Helper function to create notifications
 * IMPORTANT: Always use userId, never brokerId or propertyId directly
 * This function saves notification to database AND sends email/SMS based on user preferences
 * @param {Object} options - Notification options
 * @param {String|ObjectId} options.userId - User ID who will receive the notification (REQUIRED - always use userId)
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
    // Ensure userId is provided (never accept brokerId or propertyId directly)
    if (!userId) {
      console.error('Error creating notification: userId is required. Never use brokerId or propertyId directly.');
      return null;
    }

    // Get user preferences for email/SMS notifications
    const user = await User.findById(userId).select('email phone emailNotification smsNotification pushNotification');
    
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

    // Send email if enabled and user has email
    if (user && user.emailNotification && user.email) {
      try {
        await sendEmailNotification(user.email, title, message);
      } catch (error) {
        console.error('Error sending email notification:', error);
      }
    }

    // Send SMS if enabled and user has phone
    if (user && user.smsNotification && user.phone) {
      try {
        await sendSMSNotification(user.phone, message);
      } catch (error) {
        console.error('Error sending SMS notification:', error);
      }
    }

    // Send push notification if enabled
    if (user && user.pushNotification) {
      try {
        await sendPushNotification(userId, title, message, metadata);
      } catch (error) {
        console.error('Error sending push notification:', error);
      }
    }

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw - notifications shouldn't break main flow
    return null;
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
 * Create a single notification for region transfer
 * Creates ONE notification per region ID (similar to lead creation)
 */
export const createRegionTransferNotification = async (regionId, fromBrokerId, lead, fromBroker = null) => {
  try {
    if (!regionId) {
      console.error('createRegionTransferNotification: regionId is required');
      return null;
    }

    if (!fromBrokerId) {
      console.error('createRegionTransferNotification: fromBrokerId is required');
      return null;
    }

    // Get region details to include region name
    const region = await Region.findById(regionId).select('name');
    const regionName = region?.name || 'Unknown Region';

    // Get sender broker details
    let senderBroker = fromBroker;
    let senderUserId = null;
    let senderName = 'Unknown Broker';

    if (fromBroker) {
      senderUserId = fromBroker.userId?._id || fromBroker.userId;
      senderName = fromBroker.name || 'Unknown Broker';
    } else {
      senderBroker = await BrokerDetail.findById(fromBrokerId).select('userId name').populate('userId', 'name');
      if (senderBroker) {
        senderUserId = senderBroker.userId?._id || senderBroker.userId;
        senderName = senderBroker.name || 'Unknown Broker';
      }
    }

    if (!senderUserId) {
      console.error(`createRegionTransferNotification: Could not extract userId from broker ${fromBrokerId}`);
      return null;
    }

    const customerName = lead.customerName || 'customer';
    
    console.log(`Creating single region transfer notification: regionId=${regionId}, regionName=${regionName}, senderUserId=${senderUserId}, leadId=${lead._id || lead}`);

    const notification = await createNotification({
      userId: senderUserId, // Notification goes to SENDER broker (who transferred to region)
      type: 'transfer',
      title: `Lead Shared with ${regionName} Region`,
      message: `A lead for ${customerName} has been shared with brokers in ${regionName} region`,
      priority: 'high',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: {
        action: 'transferred',
        actorId: senderUserId,
        actorName: senderName
      },
      metadata: {
        leadId: lead._id || lead,
        fromBrokerId,
        regionId,
        regionName,
        shareType: 'region',
        customerName: lead.customerName,
        customerPhone: lead.customerPhone
      }
    });

    if (notification) {
      console.log(`Region transfer notification created successfully: notificationId=${notification._id}, userId=${senderUserId}, regionName=${regionName}`);
    } else {
      console.error(`Failed to create region transfer notification for region ${regionId}`);
    }

    return notification;
  } catch (error) {
    console.error('Error creating region transfer notification:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
};

/**
 * Create a single notification for "all brokers" transfer
 * Creates ONE notification for the sender (similar to lead creation)
 */
export const createAllBrokersTransferNotification = async (fromBrokerId, lead, fromBroker = null) => {
  try {
    if (!fromBrokerId) {
      console.error('createAllBrokersTransferNotification: fromBrokerId is required');
      return null;
    }

    // Get sender broker details
    let senderBroker = fromBroker;
    let senderUserId = null;
    let senderName = 'Unknown Broker';

    if (fromBroker) {
      senderUserId = fromBroker.userId?._id || fromBroker.userId;
      senderName = fromBroker.name || 'Unknown Broker';
    } else {
      senderBroker = await BrokerDetail.findById(fromBrokerId).select('userId name').populate('userId', 'name');
      if (senderBroker) {
        senderUserId = senderBroker.userId?._id || senderBroker.userId;
        senderName = senderBroker.name || 'Unknown Broker';
      }
    }

    if (!senderUserId) {
      console.error(`createAllBrokersTransferNotification: Could not extract userId from broker ${fromBrokerId}`);
      return null;
    }

    const customerName = lead.customerName || 'customer';
    
    console.log(`Creating single "all brokers" transfer notification: senderUserId=${senderUserId}, senderName=${senderName}, leadId=${lead._id || lead}`);

    const notification = await createNotification({
      userId: senderUserId, // Notification goes to SENDER broker (who transferred to all)
      type: 'transfer',
      title: 'Lead Shared with All Brokers',
      message: `A lead for ${customerName} has been shared with all brokers`,
      priority: 'high',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: {
        action: 'transferred',
        actorId: senderUserId,
        actorName: senderName
      },
      metadata: {
        leadId: lead._id || lead,
        fromBrokerId,
        shareType: 'all',
        customerName: lead.customerName,
        customerPhone: lead.customerPhone
      }
    });

    if (notification) {
      console.log(`"All brokers" transfer notification created successfully: notificationId=${notification._id}, userId=${senderUserId}`);
    } else {
      console.error(`Failed to create "all brokers" transfer notification for broker ${fromBrokerId}`);
    }

    return notification;
  } catch (error) {
    console.error('Error creating "all brokers" transfer notification:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
};

/**
 * Create notification for transfer events (individual or region)
 */
export const createTransferNotification = async (toBrokerId, fromBrokerId, lead, fromBroker = null) => {
  try {
    if (!toBrokerId) {
      console.error('createTransferNotification: toBrokerId is required');
      return null;
    }

    // Get the RECIPIENT broker's userId (the broker receiving the transfer)
    const toBroker = await BrokerDetail.findById(toBrokerId).select('userId name');
    if (!toBroker) {
      console.warn(`createTransferNotification: BrokerDetail ${toBrokerId} not found`);
      return null;
    }
    
    if (!toBroker.userId) {
      console.warn(`createTransferNotification: BrokerDetail ${toBrokerId} has no userId`);
      return null;
    }

    // Extract recipient userId (the broker who will receive the notification)
    const recipientUserId = toBroker.userId._id || toBroker.userId;
    
    if (!recipientUserId) {
      console.error(`createTransferNotification: Could not extract userId from broker ${toBrokerId}`);
      return null;
    }
    
    // Get sender broker name for the message
    let senderName = 'Unknown Broker';
    let senderUserId = null;
    
    if (fromBroker) {
      // Use the provided fromBroker object
      senderName = fromBroker.name || 'Unknown Broker';
      senderUserId = fromBroker.userId?._id || fromBroker.userId;
    } else if (fromBrokerId) {
      // Fetch fromBroker if not provided
      const fetchedFromBroker = await BrokerDetail.findById(fromBrokerId)
        .select('name userId')
        .populate('userId', 'name');
      if (fetchedFromBroker) {
        senderName = fetchedFromBroker.name || 'Unknown Broker';
        senderUserId = fetchedFromBroker.userId?._id || fetchedFromBroker.userId;
      }
    }

    console.log(`Creating transfer notification: recipientUserId=${recipientUserId}, senderName=${senderName}, leadId=${lead._id || lead}`);

    const notification = await createNotification({
      userId: recipientUserId, // Notification goes to RECIPIENT broker (toBroker's userId)
      type: 'transfer',
      title: 'Lead Transferred to You',
      message: `A lead for ${lead.customerName || 'customer'} has been transferred to you by ${senderName}`,
      priority: 'high',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: {
        action: 'transferred',
        actorId: senderUserId, // Who transferred it (fromBroker's userId)
        actorName: senderName
      },
      metadata: {
        leadId: lead._id || lead,
        fromBrokerId,
        toBrokerId,
        customerName: lead.customerName,
        customerPhone: lead.customerPhone
      }
    });

    if (notification) {
      console.log(`Transfer notification created successfully: notificationId=${notification._id}, userId=${recipientUserId}`);
    } else {
      console.error(`Failed to create transfer notification for broker ${toBrokerId}`);
    }

    return notification;
  } catch (error) {
    console.error('Error creating transfer notification:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
};
