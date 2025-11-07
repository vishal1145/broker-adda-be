import BrokerDetail from '../models/BrokerDetail.js';
import BrokerRating from '../models/BrokerRating.js';
import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';
import { updateRegionBrokerCount, updateMultipleRegionBrokerCounts } from '../utils/brokerCount.js';
import { createNotification } from '../utils/notifications.js';
import Subscription from '../models/Subscription.js';
import mongoose from 'mongoose';

// Get all brokers (with pagination and filtering) - All roles allowed
export const getAllBrokers = async (req, res) => {
  try {
    const { 
      page , 
      limit , 
      status, 
      approvedByAdmin, 
      regionId,
      city,
      regionCity,
      search,
      minExperience,
      maxExperience,
      verificationStatus,
      minRating,
      maxRating,
      rating,
      specialization,
      sortBy,
      sortOrder
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (approvedByAdmin !== undefined) {
      filter.approvedByAdmin = approvedByAdmin;
    }
    
    if (regionId) {
      filter.region = regionId;
    }

    if (city) {
      filter.city = { $regex: `^${city}$`, $options: 'i' };
    }

    // Filter by Region.city via regionCity param
    if (regionCity) {
      const Region = (await import('../models/Region.js')).default;
      const regions = await Region.find({ city: { $regex: `^${regionCity}$`, $options: 'i' } }).select('_id');
      const regionIds = regions.map(r => r._id);
      if (regionIds.length > 0) {
        filter.region = { $in: regionIds };
      } else {
        // Force empty result if no matching regions
        filter.region = { $in: [] };
      }
    }

    // Experience range filter (experience.years)
    if (minExperience !== undefined || maxExperience !== undefined) {
      const yearsFilter = {};
      if (minExperience !== undefined) yearsFilter.$gte = Number(minExperience);
      if (maxExperience !== undefined) yearsFilter.$lte = Number(maxExperience);
      filter['experience.years'] = yearsFilter;
    }

    // Verification status filter
    if (verificationStatus) {
      filter.verificationStatus = verificationStatus;
    }

    // Rating filters
    if (rating !== undefined) {
      filter.rating = Number(rating);
    } else if (minRating !== undefined || maxRating !== undefined) {
      filter.rating = {};
      if (minRating !== undefined) filter.rating.$gte = Number(minRating);
      if (maxRating !== undefined) filter.rating.$lte = Number(maxRating);
    }

    // Specialization filter (matches if broker has this specialization in their array)
    if (specialization) {
      filter.specializations = { $in: [specialization] };
    }

    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { whatsappNumber: { $regex: search, $options: 'i' } },
        { firmName: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { website: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    let sort = { createdAt: -1 }; // Default sort
    if (sortBy) {
      const allowedSortFields = ['rating', 'createdAt', 'name', 'firmName', 'experience.years'];
      if (allowedSortFields.includes(sortBy)) {
        const order = sortOrder === 'asc' ? 1 : -1;
        sort = { [sortBy]: order };
      }
    } else if (sortOrder) {
      // If only sortOrder provided without sortBy, apply to default createdAt
      const order = sortOrder === 'asc' ? 1 : -1;
      sort = { createdAt: order };
    }

    // Get brokers with populated region data
    const brokers = await BrokerDetail.find(filter)
      .populate('region', 'name description city state centerLocation radius')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalBrokers = await BrokerDetail.countDocuments(filter);
    const totalPages = Math.ceil(totalBrokers / parseInt(limit));

    // Get blocked and unblocked counts (without filters for overall stats)
    const totalBlockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'blocked' });
    const totalUnblockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'unblocked' });

    // Prepare lead/property stats and property lists for each broker
    const brokerIds = brokers.map(b => b._id);
    const [leadCountsAgg, leadsBasic, propertyCountsAgg, brokerProperties, ratingStatsAgg] = await Promise.all([
      Lead.aggregate([
        { $match: { createdBy: { $in: brokerIds } } },
        { $group: { _id: '$createdBy', count: { $sum: 1 } } }
      ]),
      Lead.find({ createdBy: { $in: brokerIds } })
        .select('customerName customerEmail customerPhone requirement propertyType budget status primaryRegion secondaryRegion createdAt updatedAt createdBy')
        .lean(),
      Property.aggregate([
        { $match: { broker: { $in: brokerIds } } },
        { $group: { _id: '$broker', count: { $sum: 1 } } }
      ]),
      Property.find({ broker: { $in: brokerIds } })
        .select('_id title price priceUnit images status createdAt broker')
        .sort({ createdAt: -1 })
        .lean(),
      BrokerRating.aggregate([
        { $match: { brokerId: { $in: brokerIds } } },
        {
          $group: {
            _id: '$brokerId',
            averageRating: { $avg: '$rating' },
            totalRatings: { $sum: 1 }
          }
        }
      ])
    ]);
    const brokerIdToLeadCount = new Map(leadCountsAgg.map(x => [String(x._id), x.count]));
    const brokerIdToPropertyCount = new Map(propertyCountsAgg.map(x => [String(x._id), x.count]));
    const brokerIdToRating = new Map();
    for (const r of ratingStatsAgg) {
      const key = String(r._id);
      brokerIdToRating.set(key, {
        rating: Math.round(r.averageRating * 10) / 10,
        totalRatings: r.totalRatings,
        isDefaultRating: false
      });
    }
    const brokerIdToLeads = new Map();
    const brokerIdToProperties = new Map();
    for (const l of leadsBasic) {
      const key = String(l.createdBy);
      if (!brokerIdToLeads.has(key)) brokerIdToLeads.set(key, []);
      brokerIdToLeads.get(key).push({
        _id: l._id,
        customerName: l.customerName,
        customerEmail: l.customerEmail,
        customerPhone: l.customerPhone,
        requirement: l.requirement,
        propertyType: l.propertyType,
        budget: l.budget,
        status: l.status,
        primaryRegion: l.primaryRegion,
        secondaryRegion: l.secondaryRegion,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt
      });
    }

    // Group properties by broker
    for (const p of brokerProperties) {
      const key = String(p.broker);
      if (!brokerIdToProperties.has(key)) brokerIdToProperties.set(key, []);
      brokerIdToProperties.get(key).push({
        _id: p._id,
        title: p.title,
        price: p.price,
        priceUnit: p.priceUnit,
        images: p.images,
        status: p.status,
        createdAt: p.createdAt
      });
    }

    // Convert file paths to URLs and attach lead stats
    const brokersWithUrlsPromises = brokers.map(async broker => {
      const brokerObj = broker.toObject();
     
      // Convert kycDocs file paths to URLs
      if (brokerObj.kycDocs) {
        if (brokerObj.kycDocs.aadhar) {
          brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
        }
        if (brokerObj.kycDocs.pan) {
          brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
        }
        if (brokerObj.kycDocs.gst) {
          brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
        }
        if (brokerObj.kycDocs.brokerLicense) {
          brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
        }
        if (brokerObj.kycDocs.companyId) {
          brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
        }
      }
      
      // Convert broker image path to URL
      if (brokerObj.brokerImage) {
        brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
      }

      // Attach lead and property stats
      const key = String(brokerObj._id);
      brokerObj.leadsCreated = {
        count: brokerIdToLeadCount.get(key) || 0,
        items: brokerIdToLeads.get(key) || []
      };
      brokerObj.leadCount = brokerIdToLeadCount.get(key) || 0;
      brokerObj.propertyCount = brokerIdToPropertyCount.get(key) || 0;
      brokerObj.properties = brokerIdToProperties.get(key) || [];

      // Attach rating (default 4 if no ratings)
      const ratingInfo = brokerIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
      brokerObj.rating = ratingInfo.rating;
      brokerObj.totalRatings = ratingInfo.totalRatings;
      brokerObj.isDefaultRating = ratingInfo.isDefaultRating;

      const brokerSubscription = await Subscription.findOne({ user: new mongoose.Types.ObjectId(brokerObj.userId), endDate: { $gt: new Date() } });
      brokerObj.subscription = brokerSubscription || null;

      return brokerObj;
    });

    const brokersWithUrls = await Promise.all(brokersWithUrlsPromises);

    return successResponse(res, 'Brokers retrieved successfully', {
      brokers: brokersWithUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalBrokers,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1
      },
      stats: {
        totalBlockedBrokers,
        totalUnblockedBrokers,
        totalAllBrokers: totalBlockedBrokers + totalUnblockedBrokers
      }
    });

  } catch (error) {
    console.error('Error in getAllBrokers:', error);
    return serverError(res, error);
  }
};

// Get single broker details by userId
export const getBrokerById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker by userId instead of _id
    const broker = await BrokerDetail.findOne({ userId: id })
      .populate('region', 'name description city state centerLocation radius')
      .populate('userId', 'name email phone status');

    const brokerSubscription = await Subscription.findOne({ user: new mongoose.Types.ObjectId(id), endDate: { $gt: new Date() } });

    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Convert file paths to URLs
    const brokerObj = broker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    // Lead and property stats for this broker
    const [leadCount, leads, propertyCount, properties] = await Promise.all([
      Lead.countDocuments({ createdBy: broker._id }),
      Lead.find({ createdBy: broker._id })
        .select('customerName customerEmail customerPhone requirement propertyType budget status primaryRegion secondaryRegion createdAt updatedAt')
        .lean(),
      Property.countDocuments({ broker: broker._id }),
      Property.find({ broker: broker._id })
        .select('_id title price priceUnit images status createdAt')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    // Calculate broker rating (default 4 if no ratings)
    const ratingStats = await BrokerRating.aggregate([
      { $match: { brokerId: broker._id } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]);

    // Handle case when no ratings exist (empty array or totalRatings is 0)
    const stats = ratingStats[0] || { averageRating: null, totalRatings: 0 };
    const hasRatings = stats.totalRatings > 0;
    
    const rating = hasRatings 
      ? Math.round(stats.averageRating * 10) / 10 
      : 4;

    brokerObj.rating = rating;
    brokerObj.totalRatings = stats.totalRatings;
    brokerObj.isDefaultRating = !hasRatings;

    brokerObj.leadsCreated = {
      count: leadCount,
      items: leads
    };
    brokerObj.leadCount = leadCount;
    brokerObj.propertyCount = propertyCount;
    brokerObj.properties = properties;
    brokerObj.propertiesListed = {
      count: propertyCount,
      items: properties
    };
    brokerObj.subscription = brokerSubscription ? brokerSubscription.toObject() : null;

    return successResponse(res, 'Broker details retrieved successfully', { broker: brokerObj });

  } catch (error) {
    return serverError(res, error);
  }
};

// Approve broker
export const approveBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker approval status
    broker.approvedByAdmin = 'unblocked';
    await broker.save();

    // Update user status to active if it was pending
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { status: 'active' });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Create notification for broker approval
    // Use userId from token (req.user._id)
    try {
      if (req.user?._id) {
        await createNotification({
          userId: req.user._id,
          type: 'approval',
          title: 'Broker Account Approved',
          message: 'Your broker account has been approved and unblocked by admin.',
          priority: 'high',
          relatedEntity: {
            entityType: 'BrokerDetail',
            entityId: broker._id
          },
          activity: {
            action: 'approved',
            actorId: req.user._id,
            actorName: req.user?.name || 'Admin'
          },
          metadata: {
            brokerId: broker._id,
            status: 'unblocked'
          }
        });
      }
    } catch (notifError) {
      console.error('Error creating broker approval notification:', notifError);
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker unblocked successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Reject broker
export const rejectBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker rejection status
    broker.approvedByAdmin = 'blocked';
    await broker.save();

    // Update user status to suspended if needed
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { 
        status: 'inactive' 
      });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Create notification for broker rejection/blocking
    // Use userId from token (req.user._id)
    try {
      if (req.user?._id) {
        await createNotification({
          userId: req.user._id,
          type: 'approval',
          title: 'Broker Account Blocked',
          message: 'Your broker account has been blocked by admin. Please contact support for more information.',
          priority: 'high',
          relatedEntity: {
            entityType: 'BrokerDetail',
            entityId: broker._id
          },
          activity: {
            action: 'blocked',
            actorId: req.user._id,
            actorName: req.user?.name || 'Admin'
          },
          metadata: {
            brokerId: broker._id,
            status: 'blocked'
          }
        });
      }
    } catch (notifError) {
      console.error('Error creating broker rejection notification:', notifError);
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker blocked successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Update broker verification status (Admin only)
export const updateBrokerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus } = req.body;

    // Check admin access
    if (!req.user || req.user.role !== 'admin') {
      return errorResponse(res, 'Admin access required', 403);
    }

    // Validate verificationStatus
    if (!verificationStatus || !['Verified', 'Unverified'].includes(verificationStatus)) {
      return errorResponse(res, 'Invalid verificationStatus. Must be "Verified" or "Unverified"', 400);
    }

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update verification status
    broker.verificationStatus = verificationStatus;
    await broker.save();

    // Create notification for verification status change
    // Use userId from token (req.user._id)
    try {
      if (req.user?._id) {
        await createNotification({
          userId: req.user._id,
          type: 'approval',
          title: `Broker Verification Status: ${verificationStatus}`,
          message: `Your broker verification status has been updated to ${verificationStatus} by admin.`,
          priority: verificationStatus === 'Verified' ? 'high' : 'medium',
          relatedEntity: {
            entityType: 'BrokerDetail',
            entityId: broker._id
          },
          activity: {
            action: 'verificationUpdated',
            actorId: req.user._id,
            actorName: req.user?.name || 'Admin'
          },
          metadata: {
            brokerId: broker._id,
            verificationStatus
          }
        });
      }
    } catch (notifError) {
      console.error('Error creating verification notification:', notifError);
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, `Broker verification status updated to ${verificationStatus}`, { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};
