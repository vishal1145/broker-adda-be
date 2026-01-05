import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import BrokerDetail from '../models/BrokerDetail.js';
import Property from '../models/Property.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import Lead from '../models/Lead.js';
import Message from '../models/Message.js';
import { generateEmailTemplate } from './emailTemplate.js';

// Helper function to create SMTP transporter with server-friendly settings
const createSMTPTransporter = async () => {
  const nodemailer = await import('nodemailer');
  
  const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
  const isSecure = smtpPort === 465; // Port 465 uses SSL, 587 uses STARTTLS
  
  return nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: isSecure, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT) || 60000, // 60 seconds for servers
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT) || 30000, // 30 seconds
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT) || 60000, // 60 seconds for servers
    requireTLS: !isSecure, // Require TLS for non-SSL ports
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' // Allow self-signed certs if needed (set to 'false' if having cert issues)
    },
    // DNS lookup options for server environments
    dns: {
      timeout: 10000,
      server: process.env.SMTP_DNS_SERVER || undefined // Use system DNS by default
    },
    // Pool connections for better performance
    pool: true,
    maxConnections: 1,
    maxMessages: 3
  });
};

const sendEmailNotification = async (userEmail, title, message, options = {}) => {
  try {
    // Configure email transporter with server-friendly settings
    const transporter = await createSMTPTransporter();

    // Only send if SMTP is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('Email not sent: SMTP not configured');
      return false;
    }

    // Get user name if available (for personalization)
    let userName = options.userName || 'User';
    if (!options.userName && options.userId) {
      try {
        const user = await User.findById(options.userId).select('name').lean();
        if (user?.name) {
          userName = user.name;
        }
      } catch (err) {
        // Ignore error, use default
      }
    }

    // Generate email template with header, footer, and proper formatting
    const emailContent = generateEmailTemplate({
      title: title,
      message: message,
      userName: userName
    });

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: userEmail,
      subject: title,
      text: emailContent.text,
      html: emailContent.html
    });

    console.log(`Email notification sent successfully to ${userEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending email notification:', error);
    console.error('Error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587
    });
    return false;
  }
};

// Send email verification email - uses same template format as other emails
export const sendVerificationEmail = async (userEmail, verificationToken, userName = 'User') => {
  try {
    // Configure email transporter with server-friendly settings
    const transporter = await createSMTPTransporter();

    // Only send if SMTP is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('Email verification not sent: SMTP not configured');
      return false;
    }

    // Generate verification URL
    // BASE_URL should be the full base URL (e.g., http://localhost:3000 or https://yourdomain.com)
    const baseUrl = process.env.BASE_URL || '';
    // Ensure the URL includes the /api/auth prefix for the verification endpoint
    const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;

    const emailSubject = ' Verify Your Email Address';
    const emailMessage = `Thank you for registering with Brokergully. Please verify your email address to complete your registration.\n\n` +
      `Click on the button below to verify your email address:\n\n` +
      `[Verify Email] - ${verificationUrl}\n\n` +
      `Or copy and paste this link into your browser:\n${verificationUrl}\n\n` +
      ` Note: This verification link will expire in 24 hours.\n\n` +
      `If you did not request this verification, please ignore this email.`;

    // Generate email template with header, footer, and proper formatting (same as other emails)
    const emailContent = generateEmailTemplate({
      title: emailSubject,
      message: emailMessage,
      userName: userName
    });

    // Use same sendMail pattern as sendEmailNotification
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: userEmail,
      subject: emailSubject,
      text: emailContent.text,
      html: emailContent.html
    });

    console.log(`Verification email sent successfully to ${userEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    console.error('Error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587
    });
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
    const user = await User.findById(userId).select('email phone name emailNotification smsNotification pushNotification role');
    
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

    // Get broker name if user is a broker (for better personalization)
    let displayName = user?.name || 'User';
    if (user?.role === 'broker') {
      try {
        const brokerDetail = await BrokerDetail.findOne({ userId: userId }).select('name').lean();
        if (brokerDetail?.name) {
          displayName = brokerDetail.name;
        }
      } catch (err) {
        // Fallback to user name if broker lookup fails
        console.error('Error fetching broker name for notification:', err);
      }
    }

    // Send email if enabled and user has email
    if (user && user.emailNotification && user.email) {
      try {
        await sendEmailNotification(user.email, title, message, {
          userId: userId,
          userName: displayName
        });
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
 * Create notification for enquires events
 */
export const createLeadNotification = async (userId, action, lead, actor = null) => {
  try {
    // Get customer name (handle both object and populated cases)
    const customerName = lead.customerName || 'Unknown Customer';
    const customerPhone = lead.customerPhone || '';
    const requirement = lead.requirement || '';
    const propertyType = lead.propertyType || '';
    const budget = lead.budget || null;
    
    // Populate lead with region and broker info if not already populated
    // Skip population for 'deleted' action since lead is already deleted from database
    let populatedLead = lead;
    if (action !== 'deleted' && lead._id && (!lead.primaryRegion || typeof lead.primaryRegion === 'string' || lead.primaryRegion._id)) {
      populatedLead = await Lead.findById(lead._id)
        .populate('primaryRegion', 'name city state')
        .populate('secondaryRegion', 'name city state')
        .populate('createdBy', 'name')
        .lean();
      
      // If lead was not found (already deleted), use original lead data
      if (!populatedLead) {
        populatedLead = lead;
      }
    }
    
    // Get location name from primary region
    let locationName = 'Unknown Location';
    if (populatedLead.primaryRegion) {
      if (typeof populatedLead.primaryRegion === 'object' && populatedLead.primaryRegion.name) {
        locationName = populatedLead.primaryRegion.name;
      } else if (typeof populatedLead.primaryRegion === 'string') {
        // If it's just an ID, try to fetch it
        const region = await Region.findById(populatedLead.primaryRegion).select('name').lean();
        if (region) locationName = region.name;
      }
    }
    
    // Get broker name from the user receiving the notification
    let brokerName = 'Broker';
    try {
      const brokerDetail = await BrokerDetail.findOne({ userId: userId }).select('name').lean();
      if (brokerDetail?.name) {
        brokerName = brokerDetail.name;
      } else {
        // Fallback to user name
        const user = await User.findById(userId).select('name').lean();
        if (user?.name) {
          brokerName = user.name;
        }
      }
    } catch (err) {
      console.error('Error fetching broker name:', err);
    }
    
    // Format budget in Lakhs if available
    let budgetText = '';
    if (budget) {
      const budgetInLakhs = budget / 100000;
      budgetText = `₹${budgetInLakhs} Lakh`;
    }
    
    // Format message according to template for "created" action
    let title = '';
    let message = '';
    
    if (action === 'created') {
      title = ` New Enquiry: ${customerName} for ${propertyType} in ${locationName}`;
      
      message = `You have a new property Enquiry! Here are the details from the Brokergully Command Center:\n\n`;
      message += `Customer: ${customerName} (${customerPhone})\n\n`;
      message += `Requirement: ${requirement}\n\n`;
      message += `Property Type: ${propertyType}\n\n`;
      if (budgetText) {
        message += `Budget: ${budgetText}\n\n`;
      }
      message += `Location: ${locationName}\n\n`;
      message += ` Advisory Note: Brokers who respond within 10 minutes are 3x more likely to close the deal.\n\n`;
      message += `[View Full Details & Contact Customer]`;
    } else if (action === 'deleted') {
      // Special format for deleted action - check metadata first, then lead object
      const reason = lead.deletionReason || (lead.metadata && lead.metadata.reason) || 'Marked as Junk / Duplicate / Closed';
      title = ` Enquiry Deleted: ${customerName} has been removed`;
      message = `An Enquiry linked to your profile has been deleted from the Brokergully Command Center.\n\n` +
        `Customer: ${customerName}\n\n` +
        `Reason: ${reason}\n\n` +
        `Note: This Enquiry is no longer active in your "In Progress" list. No further action is required.`;
    } else {
      // Keep original format for other actions
      const actionMessages = {
        updated: `Enquires updated for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}`,
        transferred: `Enquires for ${customerName}${customerPhone ? ` (${customerPhone})` : ''} has been transferred to you`,
        statusChanged: `Enquires status changed for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}${lead.status ? ` to ${lead.status}` : ''}`
      };

      const titles = {
        updated: `Enquires Updated: ${customerName}`,
        transferred: `Enquires Transferred: ${customerName}`,
        statusChanged: `Enquires Status Changed: ${customerName}`
      };
      
      title = titles[action] || `Enquires Activity: ${customerName}`;
      message = actionMessages[action] || `Enquires activity for ${customerName}: ${action}`;
    }

    // Build metadata
    const metadataObj = {
      leadId: lead._id || lead,
      customerName,
      customerPhone,
      requirement,
      propertyType,
      budget: budgetText,
      location: locationName,
      status: lead.status
    };

    // Add deletion reason if available
    if (action === 'deleted' && lead.deletionReason) {
      metadataObj.reason = lead.deletionReason;
    }

    return await createNotification({
      userId,
      type: 'lead',
      title: title,
      message: message,
      priority: action === 'transferred' || action === 'created' ? 'high' : 'medium',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: actor ? {
        action,
        actorId: actor._id || actor,
        actorName: actor.name || actor.name
      } : { action },
      metadata: metadataObj
    });
  } catch (error) {
    console.error('Error in createLeadNotification:', error);
    // Fallback notification - use appropriate format based on action
    const customerName = lead.customerName || 'Unknown Customer';
    const customerPhone = lead.customerPhone || '';
    
    let fallbackTitle = `Enquires Activity: ${customerName}`;
    let fallbackMessage = `Enquires activity for ${customerName}${customerPhone ? ` (${customerPhone})` : ''}`;
    
    // Use deletion format if action is deleted
    if (action === 'deleted') {
      const reason = lead.deletionReason || 'Marked as Junk / Duplicate / Closed';
      fallbackTitle = `🗑️ Enquiry Update: ${customerName} has been removed`;
      fallbackMessage = `An Enquiry linked to your profile has been deleted from the Brokergully Command Center.\n\n` +
        `Customer: ${customerName}\n\n` +
        `Reason: ${reason}\n\n` +
        `Note: This Enquiry is no longer active in your "In Progress" list. No further action is required.`;
    }
    
    return await createNotification({
      userId,
      type: 'lead',
      title: fallbackTitle,
      message: fallbackMessage,
      priority: 'medium',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id || lead
      },
      activity: { action },
      metadata: {
        leadId: lead._id || lead,
        customerName,
        customerPhone,
        ...(action === 'deleted' && lead.deletionReason ? { reason: lead.deletionReason } : {})
      }
    });
  }
};

/**
 * Create notification for property events
 */
export const createPropertyNotification = async (userId, action, property, actor = null) => {
  try {
    // Get property details (handle both object and populated cases)
    const propertyTitle = property.title || property.propertyTitle || 'Unknown Property';
    const propertyAddress = property.address || '';
    const bedrooms = property.bedrooms || property.bedroom;
    const propertyType = property.propertyType || '';
    const subType = property.subType || '';
    const price = property.price;
    const priceUnit = property.priceUnit || 'INR';
    const city = property.city || '';
    
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
      propertyDesc = propertyType || 'Property';
    }
    
    // Format price
    let priceText = 'N/A';
    if (price) {
      const formattedPrice = new Intl.NumberFormat('en-IN').format(price);
      priceText = `₹${formattedPrice}${priceUnit !== 'INR' ? ` ${priceUnit}` : ''}`;
    }
    
    // Get broker name for personalization
    let brokerName = 'Broker';
    try {
      const brokerDetail = await BrokerDetail.findOne({ userId: userId }).select('name').lean();
      if (brokerDetail?.name) {
        brokerName = brokerDetail.name;
      } else {
        const user = await User.findById(userId).select('name').lean();
        if (user?.name) {
          brokerName = user.name;
        }
      }
    } catch (err) {
      console.error('Error fetching broker name for property notification:', err);
    }
    
    // Format messages according to action
    let title = '';
    let message = '';
    
    if (action === 'created') {
      title = ` Property Created: ${propertyTitle}`;
      message = `Your property listing has been successfully created in the Brokergully Command Center.\n\n` +
        `Property: ${propertyTitle}\n\n` +
        `Price: ${priceText}\n\n` +
        (propertyAddress ? `Address: ${propertyAddress}${city ? `, ${city}` : ''}\n\n` : '') +
        `Status: Pending Approval\n\n` +
        ` Note: Your property is under review. You will be notified once it's approved and goes live.`;
    } else if (action === 'updated') {
      title = ` Property Updated: ${propertyTitle}`;
      message = `Your property listing has been updated in the Brokergully Command Center.\n\n` +
        `Property: ${propertyTitle}\n\n` +
        `Price: ${priceText}\n\n` +
        (propertyAddress ? `Address: ${propertyAddress}${city ? `, ${city}` : ''}\n\n` : '') +
        ` Note: Review the changes and ensure all details are correct.`;
    } else if (action === 'approved') {
      title = ` Property Approved: ${propertyTitle}`;
      message = `Great news! Your property listing has been approved and is now live on Brokergully.\n\n` +
        `Property: ${propertyTitle}\n\n` +
        `Price: ${priceText}\n\n` +
        (propertyAddress ? `Address: ${propertyAddress}${city ? `, ${city}` : ''}\n\n` : '') +
        `Status: Active\n\n` +
        ` Note: Your property is now visible to potential buyers and renters. Start receiving inquiries!`;
    } else if (action === 'rejected') {
      const rejectionReason = property.rejectionReason || property.notes || 'Please review and resubmit with corrections.';
      title = ` Property Rejected: ${propertyTitle}`;
      message = `Your property listing has been reviewed but requires some changes before it can be approved.\n\n` +
        `Property: ${propertyTitle}\n\n` +
        `Price: ${priceText}\n\n` +
        (propertyAddress ? `Address: ${propertyAddress}${city ? `, ${city}` : ''}\n\n` : '') +
        `Reason: ${rejectionReason}\n\n` +
        ` Note: Please review the feedback, make necessary corrections, and resubmit your property listing.`;
    } else if (action === 'deleted') {
      title = ` Property Deleted: ${propertyTitle}`;
      message = `Your property listing has been removed from the Brokergully Command Center.\n\n` +
        `Property: ${propertyTitle}\n\n` +
        `Price: ${priceText}\n\n` +
        (propertyAddress ? `Address: ${propertyAddress}${city ? `, ${city}` : ''}\n\n` : '') +
        ` Note: This property is no longer active in your listings. No further action is required.`;
    } else {
      // Default format for other actions
      title = `Property ${action.charAt(0).toUpperCase() + action.slice(1)}: ${propertyTitle}`;
      message = `Property ${action}: ${propertyTitle}${priceText !== 'N/A' ? ` (${priceText})` : ''}${propertyAddress ? ` at ${propertyAddress}` : ''}`;
    }

    return await createNotification({
      userId,
      type: 'property',
      title: title,
      message: message,
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
        city,
        bedrooms,
        propertyType,
        subType,
        price,
        priceUnit,
        status: property.status,
        ...(action === 'rejected' && property.rejectionReason ? { rejectionReason: property.rejectionReason } : {}),
        ...(action === 'deleted' && property.deletionReason ? { deletionReason: property.deletionReason } : {})
      }
    });
  } catch (error) {
    console.error('Error in createPropertyNotification:', error);
    // Fallback notification
    const propertyTitle = property.title || property.propertyTitle || 'Unknown Property';
    return await createNotification({
      userId,
      type: 'property',
      title: `Property ${action}: ${propertyTitle}`,
      message: `Property ${action}: ${propertyTitle}`,
      priority: 'medium',
      relatedEntity: {
        entityType: 'Property',
        entityId: property._id || property
      },
      activity: { action },
      metadata: {
        propertyId: property._id || property,
        title: propertyTitle
      }
    });
  }
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
      title: `Enquires Shared with ${regionName} Region`,
      message: `An enquiry for ${customerName} has been shared with brokers in ${regionName} region`,
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
      title: 'Enquires Shared with All Brokers',
      message: `An enquiry for ${customerName} has been shared with all brokers`,
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

    // Get lead details for email formatting
    const customerName = lead.customerName || 'Customer';
    const requirement = lead.requirement || 'N/A';
    const propertyType = lead.propertyType || 'Property';
    const budget = lead.budget || null;
    
    // Format budget with ₹ symbol
    let budgetText = 'N/A';
    if (budget) {
      const formattedBudget = new Intl.NumberFormat('en-IN').format(budget);
      budgetText = `₹${formattedBudget}`;
    }

    // Get primary region name
    let regionName = 'Unknown Region';
    if (lead.primaryRegion) {
      // Check if it's a populated object with name property
      if (typeof lead.primaryRegion === 'object' && lead.primaryRegion !== null) {
        // Handle Mongoose document or plain object
        if (lead.primaryRegion.name) {
          regionName = lead.primaryRegion.name;
        } else if (lead.primaryRegion._id) {
          // If it's an object but name is missing, try to fetch it
          const region = await Region.findById(lead.primaryRegion._id).select('name').lean();
          if (region && region.name) {
            regionName = region.name;
          } else {
            console.warn(`Region not found for ID: ${lead.primaryRegion._id}`);
          }
        }
      } else if (typeof lead.primaryRegion === 'string' || lead.primaryRegion instanceof mongoose.Types.ObjectId) {
        // If it's just an ID (string or ObjectId), fetch it
        const region = await Region.findById(lead.primaryRegion).select('name').lean();
        if (region && region.name) {
          regionName = region.name;
        } else {
          console.warn(`Region not found for ID: ${lead.primaryRegion}`);
        }
      }
    } else {
      console.warn(`Lead ${lead._id || 'unknown'} has no primaryRegion`);
    }

    // Format email subject and message according to requirements
    const emailSubject = ` Enquiry Transferred: ${customerName} – ${propertyType}`;
    const emailMessage = `A property Enquiry has been transferred to you by ${senderName}.\n\n` +
      `Customer: ${customerName}\n\n` +
      `Requirement: ${requirement}\n\n` +
      `Budget: ${budgetText}\n\n` +
      `Region: ${regionName}\n\n` +
      ` Advisory Note: This lead was shared from another region. Review the details and accept the transfer to begin communication.`;

    const notification = await createNotification({
      userId: recipientUserId, // Notification goes to RECIPIENT broker (toBroker's userId)
      type: 'transfer',
      title: emailSubject, // Use formatted email subject
      message: emailMessage, // Use formatted email message
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
        customerPhone: lead.customerPhone,
        requirement,
        propertyType,
        budget: budgetText,
        regionName
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
