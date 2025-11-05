import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import mongoose from 'mongoose';
import { getFileUrl } from '../middleware/upload.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { createLeadNotification, createTransferNotification } from '../utils/notifications.js';
import User from '../models/User.js';

// Helpers
const findBrokerDetailIdByUserId = async (userId) => {
  const broker = await BrokerDetail.findOne({ userId }).select('_id');
  return broker ? broker._id : null;
};

const findBrokerDetailWithRegionsByUserId = async (userId) => {
  const broker = await BrokerDetail.findOne({ userId }).select('_id region');
  return broker;
};

const buildTransferFilterForBroker = (brokerDetailId, brokerRegions = []) => {
  if (!brokerDetailId) return null;

  const brokerRegionIds = brokerRegions.map(r => 
    mongoose.Types.ObjectId.isValid(r) ? new mongoose.Types.ObjectId(String(r)) : r
  ).filter(Boolean);

  // Build filter based on shareType:
  // 1. 'all' - show to all brokers (no specific broker filter needed)
  // 2. 'region' - show to brokers whose region array contains transfer.region
  // 3. 'individual' - show only to the specific broker (transfer.toBroker)
  return {
    $or: [
      // Individual transfers: broker is the toBroker
      {
        'transfers': {
          $elemMatch: {
            shareType: 'individual',
            toBroker: brokerDetailId
          }
        }
      },
      // Region transfers: broker has the same region as transfer.region
      ...(brokerRegionIds.length > 0 ? [{
        'transfers': {
          $elemMatch: {
            shareType: 'region',
            region: { $in: brokerRegionIds }
          }
        }
      }] : []),
      // All transfers: show to all brokers (brokerDetailId can be any broker)
      {
        'transfers': {
          $elemMatch: {
            shareType: 'all'
          }
        }
      }
    ]
  };
};

const applyBrokerDefaults = (payload, brokerDetailId) => {
  if (!brokerDetailId) return payload;

  const updated = { ...payload };

  if (!updated.createdBy) {
    updated.createdBy = brokerDetailId;
  }

  if (Array.isArray(updated.transfers)) {
    updated.transfers = updated.transfers.map(t => {
      const shareType = t?.shareType || 'individual';
      const transfer = {
        fromBroker: t?.fromBroker || brokerDetailId,
        shareType: shareType
      };
      
      // Only add toBroker if shareType is 'individual'
      if (shareType === 'individual' && t?.toBroker) {
        transfer.toBroker = t.toBroker;
      }
      
      // Only add region if shareType is 'region'
      if (shareType === 'region' && t?.region) {
        transfer.region = t.region;
      }
      
      return transfer;
    });
  }

  return updated;
};

const validateBrokerRefsExist = async (payload) => {
  if (payload.createdBy) {
    const exists = await BrokerDetail.exists({ _id: payload.createdBy });
    if (!exists) return 'Invalid createdBy: broker not found';
  }

  if (Array.isArray(payload.transfers)) {
    for (const t of payload.transfers) {
      if (t?.fromBroker) {
        const exists = await BrokerDetail.exists({ _id: t.fromBroker });
        if (!exists) return 'Invalid transfers.fromBroker: broker not found';
      }
      if (t?.toBroker) {
        const exists = await BrokerDetail.exists({ _id: t.toBroker });
        if (!exists) return 'Invalid transfers.toBroker: broker not found';
      }
    }
  }

  return null;
};

export const createLead = async (req, res) => {
  try {
    let payload = req.body || {};

    // Validate and map primary/secondary region IDs
    if (!payload.primaryRegion && payload.primaryRegionId) {
      payload.primaryRegion = payload.primaryRegionId;
    }
    if (!payload.secondaryRegion && payload.secondaryRegionId !== undefined) {
      const val = payload.secondaryRegionId;
      if (val === '' || val === null) {
        payload.secondaryRegion = undefined;
      } else {
        payload.secondaryRegion = val;
      }
    }
    // Back-compat: map regionId -> primaryRegion
    if (!payload.primaryRegion && payload.regionId) {
      payload.primaryRegion = payload.regionId;
    }
    if (!payload.primaryRegion) {
      return errorResponse(res, 'primaryRegionId is required', 400);
    }
    const Region = (await import('../models/Region.js')).default;
    const primaryExists = await Region.exists({ _id: payload.primaryRegion });
    if (!primaryExists) {
      return errorResponse(res, 'Invalid primaryRegionId: region not found', 400);
    }
    if (payload.secondaryRegion) {
      const secondaryExists = await Region.exists({ _id: payload.secondaryRegion });
      if (!secondaryExists) {
        return errorResponse(res, 'Invalid secondaryRegionId: region not found', 400);
      }
    }

    // Defaults from logged-in broker
    if (req.user && req.user.role === 'broker') {
      try {
        const brokerDetailId = await findBrokerDetailIdByUserId(req.user._id);
        payload = applyBrokerDefaults(payload, brokerDetailId);
      } catch (_) {
        // Non-fatal: continue without defaults if lookup fails
      }
    }

    // Validate provided broker references
    try {
      const validationError = await validateBrokerRefsExist(payload);
      if (validationError) {
        return errorResponse(res, validationError, 400);
      }
    } catch (e) {
      return serverError(res, e);
    }

    const lead = new Lead(payload);
    await lead.save();
    
    // Create notification for lead creation
    try {
      const admins = await User.find({ role: 'admin', status: 'active' }).select('_id');
      const adminIds = admins.map(admin => admin._id.toString());
      
      // Notify admin users about new lead
      await Promise.all(
        admins.map(admin =>
          createLeadNotification(admin._id, 'created', lead, req.user)
        )
      );
      
      // Notify the creator broker if they're not already notified (not an admin and not the same user)
      if (payload.createdBy) {
        const broker = await BrokerDetail.findById(payload.createdBy).select('userId');
        if (broker?.userId) {
          const brokerUserId = broker.userId._id || broker.userId;
          const brokerUserIdStr = brokerUserId.toString();
          const reqUserIdStr = req.user?._id?.toString();
          
          // Only notify if: not the same user AND not already notified as admin
          if (brokerUserIdStr !== reqUserIdStr && !adminIds.includes(brokerUserIdStr)) {
            await createLeadNotification(brokerUserId, 'created', lead, req.user);
          }
        }
      }
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error creating lead notification:', notifError);
    }
    
    // Back-compat alias for clients expecting `region`
    const leadCreated = lead.toObject ? lead.toObject() : lead;
    leadCreated.region = leadCreated.primaryRegion;
    return successResponse(res, 'Lead created successfully', { lead: leadCreated }, 201);
  } catch (error) {
    // Duplicate key error from Mongo for unique indexes
    if (error?.code === 11000 && error?.keyPattern) {
      const fields = Object.keys(error.keyPattern).join(', ');
      return errorResponse(res, `Duplicate value for: ${fields}`, 409);
    }
    return serverError(res, error);
  }
};

export const getLeads = async (req, res) => {
  try {
    const {
      page ,
      limit ,
      search,
      status,
      propertyType,
      region,
      city,
      regionCity,
      regionId,
      primaryRegionId,
      secondaryRegionId,
      requirement,
      budgetMin,
      budgetMax,
      createdBy,
      customerEmail,
      customerPhone,
      dateRange,
      fromDate,
      toDate,
      verificationStatus,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (createdBy) filter.createdBy = createdBy;
    // Filter by primary region (specific filter)
    if (primaryRegionId) {
      const idAsString = String(primaryRegionId);
      if (!mongoose.Types.ObjectId.isValid(idAsString)) {
        return errorResponse(res, 'Invalid primaryRegionId format', 400);
      }
      filter.primaryRegion = new mongoose.Types.ObjectId(idAsString);
    }

    // Filter by secondary region (specific filter)
    if (secondaryRegionId) {
      const idAsString = String(secondaryRegionId);
      if (!mongoose.Types.ObjectId.isValid(idAsString)) {
        return errorResponse(res, 'Invalid secondaryRegionId format', 400);
      }
      filter.secondaryRegion = new mongoose.Types.ObjectId(idAsString);
    }

    // Resolve region filter: match either primaryRegion or secondaryRegion (for backward compatibility)
    const resolvedRegionId = regionId || region;
    // Optional city filter (case-insensitive) against customer address fields if present
    if (city) {
      const cityRegex = { $regex: `^${city}$`, $options: 'i' };
      // If your lead schema has a city field, filter directly; else apply to requirement/address text
      // Example applying to requirement text as fallback
      filter.$and = (filter.$and || []);
      filter.$and.push({ $or: [ { customerCity: cityRegex }, { requirement: { $regex: city, $options: 'i' } } ] });
    }
    // Only apply regionId filter if primaryRegionId and secondaryRegionId are not set
    if (resolvedRegionId && !primaryRegionId && !secondaryRegionId) {
      const idAsString = String(resolvedRegionId);
      if (!mongoose.Types.ObjectId.isValid(idAsString)) {
        return errorResponse(res, 'Invalid regionId format', 400);
      }
      const objectId = new mongoose.Types.ObjectId(idAsString);
      filter.$or = [
        { primaryRegion: objectId },
        { secondaryRegion: objectId }
      ];
    }

    // Filter by Region.city name -> resolve to Region IDs and filter primary/secondary
    if (regionCity) {
      const Region = (await import('../models/Region.js')).default;
      const regions = await Region.find({ city: { $regex: `^${regionCity}$`, $options: 'i' } }).select('_id');
      const regionIds = regions.map(r => r._id);
      if (regionIds.length > 0) {
        filter.$or = [
          ...(filter.$or || []),
          { primaryRegion: { $in: regionIds } },
          { secondaryRegion: { $in: regionIds } }
        ];
      } else {
        // ensure no match
        filter.$and = [ ...(filter.$and || []), { _id: { $exists: false } } ];
      }
    }
    if (requirement) filter.requirement = { $regex: requirement, $options: 'i' };
    if (budgetMin || budgetMax) {
      filter.budget = {};
      if (budgetMin) filter.budget.$gte = Number(budgetMin);
      if (budgetMax) filter.budget.$lte = Number(budgetMax);
    }
    if (customerEmail) filter.customerEmail = customerEmail;
    if (customerPhone) filter.customerPhone = customerPhone;

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { requirement: { $regex: search, $options: 'i' } }
      ];
    }

    // Date range filter - handle preset ranges or custom dates
    if (dateRange) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      filter.createdAt = {};
      
      switch (dateRange.toLowerCase()) {
        case 'today':
          filter.createdAt.$gte = startOfToday;
          filter.createdAt.$lte = endOfToday;
          break;
        case 'last7days':
          const last7Days = new Date(now);
          last7Days.setDate(now.getDate() - 7);
          last7Days.setHours(0, 0, 0, 0);
          filter.createdAt.$gte = last7Days;
          filter.createdAt.$lte = endOfToday;
          break;
        case 'last30days':
          const last30Days = new Date(now);
          last30Days.setDate(now.getDate() - 30);
          last30Days.setHours(0, 0, 0, 0);
          filter.createdAt.$gte = last30Days;
          filter.createdAt.$lte = endOfToday;
          break;
      }
    } else if (fromDate || toDate) {
      // Custom date range
      filter.createdAt = {};
      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    // Verification status filter
    if (verificationStatus) {
      filter.verificationStatus = verificationStatus;
    }

    // If logged-in broker, filter leads based on transfer shareType
    if (req.user && req.user.role === 'broker') {
      try {
        const brokerDetail = await findBrokerDetailWithRegionsByUserId(req.user._id);
        if (brokerDetail) {
          const brokerDetailId = brokerDetail._id;
          const brokerRegions = Array.isArray(brokerDetail.region) ? brokerDetail.region : [];
          
          // Build transfer filter based on shareType
          const transferFilter = buildTransferFilterForBroker(brokerDetailId, brokerRegions);
          
          // Also include leads created by this broker
          const brokerFilter = {
            $or: [
              { createdBy: brokerDetailId },
              ...(transferFilter ? [transferFilter] : [])
            ]
          };
          
          // Merge with existing filter
          if (filter.$and) {
            filter.$and.push(brokerFilter);
          } else {
            filter.$and = [brokerFilter];
          }
        }
      } catch (err) {
        console.error('Error building broker filter:', err);
        // Non-fatal: continue without broker filter if lookup fails
      }
    }

    const pageNum = Number.isFinite(parseInt(page)) && parseInt(page) > 0 ? parseInt(page) : 1;
    const limitNum = Number.isFinite(parseInt(limit)) && parseInt(limit) > 0 ? parseInt(limit) : 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [items, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate({
          path: 'createdBy',
          select: 'name email phone firmName brokerImage userId',
          populate: {
            path: 'userId',
            select: '_id name email phone role'
          }
        })
        .populate({ path: 'primaryRegion', select: 'name state city' })
        .populate({ path: 'secondaryRegion', select: 'name state city' })
        .populate({
          path: 'transfers.fromBroker',
          select: 'name email phone firmName brokerImage region',
          populate: { path: 'region', select: 'name state city description' }
        })
        .populate({
          path: 'transfers.toBroker',
          select: 'name email phone firmName brokerImage region',
          populate: { path: 'region', select: 'name state city description' }
        })
        .lean(),
      Lead.countDocuments(filter)
    ]);

    // Convert brokerImage paths to URLs
    const itemsWithImageUrls = (items || []).map(item => {
      const lead = { ...item };
      if (lead.createdBy && typeof lead.createdBy === 'object') {
        lead.createdBy = { ...lead.createdBy, brokerImage: getFileUrl(req, lead.createdBy.brokerImage) };
      }
      if (Array.isArray(lead.transfers)) {
        lead.transfers = lead.transfers.map(t => {
          const tr = { ...t };
          if (tr.fromBroker && typeof tr.fromBroker === 'object') {
            const fb = { ...tr.fromBroker, brokerImage: getFileUrl(req, tr.fromBroker.brokerImage) };
            const regions = Array.isArray(fb.region) ? fb.region : [];
            fb.primaryRegion = regions.length > 0 ? regions[0] : null;
            fb.secondaryRegion = regions.length > 1 ? regions[1] : null;
            tr.fromBroker = fb;
          }
          if (tr.toBroker && typeof tr.toBroker === 'object') {
            const tb = { ...tr.toBroker, brokerImage: getFileUrl(req, tr.toBroker.brokerImage) };
            const regions = Array.isArray(tb.region) ? tb.region : [];
            tb.primaryRegion = regions.length > 0 ? regions[0] : null;
            tb.secondaryRegion = regions.length > 1 ? regions[1] : null;
            tr.toBroker = tb;
          }
          return tr;
        });
      }
      // Back-compat alias
      lead.region = lead.primaryRegion;
      return lead;
    });

    const totalPages = Math.ceil(total / limitNum);

    return successResponse(res, 'Leads retrieved successfully', {
      items: itemsWithImageUrls,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1
    });
  } catch (error) {
    return serverError(res, error);
  }
};

export const getLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id)
      .populate({
        path: 'createdBy',
        select: 'name email phone firmName brokerImage userId',
        populate: {
          path: 'userId',
          select: '_id name email phone role'
        }
      })
      .populate({ path: 'primaryRegion', select: 'name state city description' })
      .populate({ path: 'secondaryRegion', select: 'name state city description' })
      .populate({
        path: 'transfers.fromBroker',
        select: 'name email phone firmName brokerImage region',
        populate: { path: 'region', select: 'name state city description' }
      })
      .populate({
        path: 'transfers.toBroker',
        select: 'name email phone firmName brokerImage region',
        populate: { path: 'region', select: 'name state city description' }
      })
      .lean();

    if (!lead) return errorResponse(res, 'Lead not found', 404);

    // Convert brokerImage paths to URLs in detail too
    if (lead.createdBy && typeof lead.createdBy === 'object') {
      lead.createdBy.brokerImage = getFileUrl(req, lead.createdBy.brokerImage);
    }
    if (Array.isArray(lead.transfers)) {
      lead.transfers = lead.transfers.map(t => {
        const tr = { ...t };
        if (tr.fromBroker && typeof tr.fromBroker === 'object') {
          tr.fromBroker.brokerImage = getFileUrl(req, tr.fromBroker.brokerImage);
          const regions = Array.isArray(tr.fromBroker.region) ? tr.fromBroker.region : [];
          tr.fromBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
          tr.fromBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
        }
        if (tr.toBroker && typeof tr.toBroker === 'object') {
          tr.toBroker.brokerImage = getFileUrl(req, tr.toBroker.brokerImage);
          const regions = Array.isArray(tr.toBroker.region) ? tr.toBroker.region : [];
          tr.toBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
          tr.toBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
        }
        return tr;
      });
    }

    // Back-compat alias
    if (lead) {
      lead.region = lead.primaryRegion;
    }
    return successResponse(res, 'Lead retrieved successfully', { lead });
  } catch (error) {
    return serverError(res, error);
  }
};

export const getTransferredLeads = async (req, res) => {
  try {
    const {
      page,
      limit,
      search,
      status,
      propertyType,
      region,
      regionId,
      requirement,
      budgetMin,
      budgetMax,
      createdBy,
      customerEmail,
      customerPhone,
      fromDate,
      toDate,
      toBroker,
      fromBroker,
      brokerId, // Additional filter for any broker involvement
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query || {};

    // Build base filter with all lead fields (same as getLeads)
    const filter = {};

    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (createdBy) filter.createdBy = createdBy;
    
    // Resolve region filter: match either primaryRegion or secondaryRegion
    const resolvedRegionId = regionId || region;
    if (resolvedRegionId) {
      const idAsString = String(resolvedRegionId);
      if (!mongoose.Types.ObjectId.isValid(idAsString)) {
        return errorResponse(res, 'Invalid regionId format', 400);
      }
      const objectId = new mongoose.Types.ObjectId(idAsString);
      filter.$or = [
        { primaryRegion: objectId },
        { secondaryRegion: objectId }
      ];
    }
    
    if (requirement) filter.requirement = { $regex: requirement, $options: 'i' };
    if (budgetMin || budgetMax) {
      filter.budget = {};
      if (budgetMin) filter.budget.$gte = Number(budgetMin);
      if (budgetMax) filter.budget.$lte = Number(budgetMax);
    }
    if (customerEmail) filter.customerEmail = customerEmail;
    if (customerPhone) filter.customerPhone = customerPhone;

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { requirement: { $regex: search, $options: 'i' } }
      ];
    }

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    // Add transfer-specific filters
    const matchTransfers = {};
    const transferConditions = [];
    
    // Handle explicit query parameter filters
    if (toBroker) {
      if (!mongoose.Types.ObjectId.isValid(String(toBroker))) {
        return errorResponse(res, 'Invalid toBroker format', 400);
      }
      const toBrokerId = new mongoose.Types.ObjectId(String(toBroker));
      
      // Get broker details to check regions for shareType: "region" filtering
      try {
        const brokerDetail = await BrokerDetail.findById(toBrokerId).select('region');
        const brokerRegions = brokerDetail ? (Array.isArray(brokerDetail.region) ? brokerDetail.region : []) : [];
        const brokerRegionIds = brokerRegions.map(r => 
          mongoose.Types.ObjectId.isValid(r) ? new mongoose.Types.ObjectId(String(r)) : r
        ).filter(Boolean);
        
        const toBrokerConditions = [
          // Individual transfers: broker is the toBroker
          {
            'transfers': {
              $elemMatch: {
                shareType: 'individual',
                toBroker: toBrokerId
              }
            }
          },
          // All transfers: visible to all brokers
          {
            'transfers': {
              $elemMatch: {
                shareType: 'all'
              }
            }
          }
        ];
        
        // Region transfers: broker's region array contains transfer's region
        if (brokerRegionIds.length > 0) {
          toBrokerConditions.push({
            'transfers': {
              $elemMatch: {
                shareType: 'region',
                region: { $in: brokerRegionIds }
              }
            }
          });
        }
        
        transferConditions.push({
          $or: toBrokerConditions
        });
      } catch (err) {
        // Fallback to individual only if broker lookup fails
        transferConditions.push({
          'transfers': {
            $elemMatch: {
              shareType: 'individual',
              toBroker: toBrokerId
            }
          }
        });
      }
    }
    
    if (fromBroker) {
      if (!mongoose.Types.ObjectId.isValid(String(fromBroker))) {
        return errorResponse(res, 'Invalid fromBroker format', 400);
      }
      const fromBrokerId = new mongoose.Types.ObjectId(String(fromBroker));
      transferConditions.push({
        'transfers.fromBroker': fromBrokerId
      });
    }
    
    if (brokerId) {
      if (!mongoose.Types.ObjectId.isValid(String(brokerId))) {
        return errorResponse(res, 'Invalid brokerId format', 400);
      }
      const brokerObjectId = new mongoose.Types.ObjectId(String(brokerId));
      
      // Get broker details to check regions
      try {
        const brokerDetail = await BrokerDetail.findById(brokerObjectId).select('region');
        const brokerRegions = brokerDetail ? (Array.isArray(brokerDetail.region) ? brokerDetail.region : []) : [];
        const brokerRegionIds = brokerRegions.map(r => 
          mongoose.Types.ObjectId.isValid(r) ? new mongoose.Types.ObjectId(String(r)) : r
        ).filter(Boolean);
        
        const brokerIdConditions = [
          { 'transfers.fromBroker': brokerObjectId },
          {
            'transfers': {
              $elemMatch: {
                shareType: 'individual',
                toBroker: brokerObjectId
              }
            }
          },
          {
            'transfers': {
              $elemMatch: {
                shareType: 'all'
              }
            }
          }
        ];
        
        // Add region condition if broker has regions
        if (brokerRegionIds.length > 0) {
          brokerIdConditions.push({
            'transfers': {
              $elemMatch: {
                shareType: 'region',
                region: { $in: brokerRegionIds }
              }
            }
          });
        }
        
        transferConditions.push({
          $or: brokerIdConditions
        });
      } catch (err) {
        // Fallback to simple check if broker lookup fails
        transferConditions.push({
          $or: [
            { 'transfers.fromBroker': brokerObjectId },
            {
              'transfers': {
                $elemMatch: {
                  shareType: 'individual',
                  toBroker: brokerObjectId
                }
              }
            }
          ]
        });
      }
    }

    // If logged-in broker, filter to show leads based on transfer shareType
    if (req.user && req.user.role === 'broker') {
      try {
        const brokerDetail = await findBrokerDetailWithRegionsByUserId(req.user._id);
        if (brokerDetail) {
          const brokerDetailId = brokerDetail._id;
          const brokerRegions = Array.isArray(brokerDetail.region) ? brokerDetail.region : [];
          
          // Build transfer filter based on shareType:
          // - individual: show if broker is the toBroker
          // - region: show if broker's region array contains transfer.region
          // - all: show to all brokers (any broker can see)
          const brokerTransferConditions = [];
          
          // Individual transfers: broker is the toBroker
          brokerTransferConditions.push({
            'transfers': {
              $elemMatch: {
                shareType: 'individual',
                toBroker: brokerDetailId
              }
            }
          });
          
          // Region transfers: broker's region array contains transfer.region
          if (brokerRegions.length > 0) {
            const brokerRegionIds = brokerRegions.map(r => 
              mongoose.Types.ObjectId.isValid(r) ? new mongoose.Types.ObjectId(String(r)) : r
            ).filter(Boolean);
            
            if (brokerRegionIds.length > 0) {
              brokerTransferConditions.push({
                'transfers': {
                  $elemMatch: {
                    shareType: 'region',
                    region: { $in: brokerRegionIds }
                  }
                }
              });
            }
          }
          
          // All transfers: show to all brokers (any broker can see)
          brokerTransferConditions.push({
            'transfers': {
              $elemMatch: {
                shareType: 'all'
              }
            }
          });
          
          // Also include leads where broker is fromBroker
          brokerTransferConditions.push({
            'transfers.fromBroker': brokerDetailId
          });
          
          // Combine broker-specific conditions
          transferConditions.push({
            $or: brokerTransferConditions
          });
        }
      } catch (err) {
        console.error('Error building broker filter:', err);
        // Non-fatal: continue without broker filter if lookup fails
      }
    }
    
    // Combine all transfer conditions
    if (transferConditions.length > 0) {
      if (transferConditions.length === 1) {
        Object.assign(matchTransfers, transferConditions[0]);
      } else {
        matchTransfers.$and = transferConditions;
      }
    }

    // Ensure leads have at least one transfer
    const baseTransferFilter = { transfers: { $exists: true, $ne: [] } };
    const finalFilter = { ...filter, ...baseTransferFilter, ...matchTransfers };

    const pageNum = Number.isFinite(parseInt(page)) && parseInt(page) > 0 ? parseInt(page) : 1;
    const limitNum = Number.isFinite(parseInt(limit)) && parseInt(limit) > 0 ? parseInt(limit) : 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [items, total] = await Promise.all([
      Lead.find(finalFilter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate({
          path: 'createdBy',
          select: 'name email phone firmName brokerImage userId',
          populate: {
            path: 'userId',
            select: '_id name email phone role'
          }
        })
        .populate({ path: 'primaryRegion', select: 'name state city' })
        .populate({ path: 'secondaryRegion', select: 'name state city' })
        .populate({
          path: 'transfers.fromBroker',
          select: 'name email phone firmName brokerImage region',
          populate: { path: 'region', select: 'name state city description' }
        })
        .populate({
          path: 'transfers.toBroker',
          select: 'name email phone firmName brokerImage region',
          populate: { path: 'region', select: 'name state city description' }
        })
        .lean(),
      Lead.countDocuments(finalFilter)
    ]);

    const itemsWithImageUrls = (items || []).map(item => {
      const lead = { ...item };
      if (lead.createdBy && typeof lead.createdBy === 'object') {
        lead.createdBy = { ...lead.createdBy, brokerImage: getFileUrl(req, lead.createdBy.brokerImage) };
      }
      if (Array.isArray(lead.transfers)) {
        lead.transfers = lead.transfers.map(t => {
          const tr = { ...t };
          if (tr.fromBroker && typeof tr.fromBroker === 'object') {
            const fb = { ...tr.fromBroker, brokerImage: getFileUrl(req, tr.fromBroker.brokerImage) };
            const regions = Array.isArray(fb.region) ? fb.region : [];
            fb.primaryRegion = regions.length > 0 ? regions[0] : null;
            fb.secondaryRegion = regions.length > 1 ? regions[1] : null;
            tr.fromBroker = fb;
          }
          if (tr.toBroker && typeof tr.toBroker === 'object') {
            const tb = { ...tr.toBroker, brokerImage: getFileUrl(req, tr.toBroker.brokerImage) };
            const regions = Array.isArray(tb.region) ? tb.region : [];
            tb.primaryRegion = regions.length > 0 ? regions[0] : null;
            tb.secondaryRegion = regions.length > 1 ? regions[1] : null;
            tr.toBroker = tb;
          }
          return tr;
        });
      }
      return lead;
    });

    const totalPages = Math.ceil(total / limitNum);

    return successResponse(res, 'Transferred leads retrieved successfully', {
      items: itemsWithImageUrls,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1
    });
  } catch (error) {
    return serverError(res, error);
  }
};

export const getLeadMetrics = async (req, res) => {
  try {
    // Optional filters/actors
    const { brokerId, createdBy } = req.query || {};

    // createdBy filter should ONLY apply if explicitly provided
    let createdByBrokerId = createdBy || null;
    if (createdByBrokerId && !mongoose.Types.ObjectId.isValid(String(createdByBrokerId))) {
      return errorResponse(res, 'Invalid createdBy format', 400);
    }

    const matchBase = {};
    if (createdByBrokerId) {
      matchBase.createdBy = new mongoose.Types.ObjectId(String(createdByBrokerId));
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Resolve WHICH broker to use for transfer metrics (actor)
    let actorBrokerId = brokerId || null;
    if (!actorBrokerId && req.user && req.user.role === 'broker') {
      try {
        const bd = await findBrokerDetailIdByUserId(req.user._id);
        if (bd) actorBrokerId = String(bd);
      } catch (_) {}
    }

    // If brokerId provided might be a User id, try mapping to BrokerDetail
    if (actorBrokerId && !mongoose.Types.ObjectId.isValid(String(actorBrokerId))) {
      return errorResponse(res, 'Invalid brokerId format', 400);
    }
    // Validate/normalize actorBrokerId: if it doesn't exist as BrokerDetail _id, try by userId
    if (actorBrokerId) {
      const existsAsBD = await BrokerDetail.exists({ _id: actorBrokerId });
      if (!existsAsBD) {
        const byUser = await BrokerDetail.findOne({ userId: actorBrokerId }).select('_id').lean();
        if (byUser) actorBrokerId = String(byUser._id);
      }
    }

    const [totalLeads, newLeadsToday, convertedLeads, avgDealAgg, transfersToMeAgg, transfersByMeAgg, totalProperties] = await Promise.all([
      Lead.countDocuments(matchBase),
      Lead.countDocuments({ ...matchBase, createdAt: { $gte: startOfToday, $lte: endOfToday } }),
      Lead.countDocuments({ ...matchBase, status: 'Closed' }),
      Lead.aggregate([
        { $match: { ...matchBase, status: 'Closed', budget: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$budget' } } },
        { $project: { _id: 0, avg: 1 } }
      ]),
      actorBrokerId
        ? Lead.aggregate([
            { $unwind: '$transfers' },
            { $match: { 'transfers.toBroker': new mongoose.Types.ObjectId(String(actorBrokerId)) } },
            { $count: 'count' }
          ])
        : Promise.resolve([]),
      actorBrokerId
        ? Lead.aggregate([
            { $unwind: '$transfers' },
            { $match: { 'transfers.fromBroker': new mongoose.Types.ObjectId(String(actorBrokerId)) } },
            { $count: 'count' }
          ])
        : Promise.resolve([]),
      // Total properties (scoped to broker if createdBy provided)
      createdByBrokerId
        ? Property.countDocuments({ broker: createdByBrokerId })
        : Property.countDocuments()
    ]);

    const averageDealSize = Array.isArray(avgDealAgg) && avgDealAgg.length > 0 ? avgDealAgg[0].avg : 0;
    const transfersToMe = Array.isArray(transfersToMeAgg) && transfersToMeAgg.length > 0 ? transfersToMeAgg[0].count : 0;
    const transfersByMe = Array.isArray(transfersByMeAgg) && transfersByMeAgg.length > 0 ? transfersByMeAgg[0].count : 0;

    return successResponse(res, 'Lead metrics retrieved successfully', {
      totalLeads,
      newLeadsToday,
      convertedLeads,
      averageDealSize,
      transfersToMe,
      transfersByMe,
      totalProperties
    });
  } catch (error) {
    return serverError(res, error);
  }
};


export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    // Check if lead exists
    const existingLead = await Lead.findById(id);
    if (!existingLead) {
      return errorResponse(res, 'Lead not found', 404);
    }

    // API-level uniqueness checks (only when values are being updated)
    if (payload.customerEmail && payload.customerEmail !== existingLead.customerEmail) {
      const exists = await Lead.exists({ 
        customerEmail: payload.customerEmail,
        _id: { $ne: id }
      });
      if (exists) {
        return errorResponse(res, 'Customer email already exists for another lead', 409);
      }
    }
    
    if (payload.customerPhone && payload.customerPhone !== existingLead.customerPhone) {
      const exists = await Lead.exists({ 
        customerPhone: payload.customerPhone,
        _id: { $ne: id }
      });
      if (exists) {
        return errorResponse(res, 'Customer phone already exists for another lead', 409);
      }
    }

    // Validate and map primary/secondary on update
    if (payload.primaryRegionId) {
      payload.primaryRegion = payload.primaryRegionId;
      delete payload.primaryRegionId;
    }
    if (payload.secondaryRegionId !== undefined) {
      const val = payload.secondaryRegionId;
      if (val === '' || val === null) {
        payload.secondaryRegion = undefined;
      } else {
        payload.secondaryRegion = val;
      }
      delete payload.secondaryRegionId;
    }
    // Back-compat
    if (payload.regionId) {
      payload.primaryRegion = payload.regionId;
      delete payload.regionId;
    }
    const RegionUpdate = (await import('../models/Region.js')).default;
    if (payload.primaryRegion) {
      const existsPrimary = await RegionUpdate.exists({ _id: payload.primaryRegion });
      if (!existsPrimary) {
        return errorResponse(res, 'Invalid primaryRegionId: region not found', 400);
      }
    }
    if (payload.secondaryRegion) {
      const existsSecondary = await RegionUpdate.exists({ _id: payload.secondaryRegion });
      if (!existsSecondary) {
        return errorResponse(res, 'Invalid secondaryRegionId: region not found', 400);
      }
    }

    // Validate provided broker references
    try {
      const validationError = await validateBrokerRefsExist(payload);
      if (validationError) {
        return errorResponse(res, validationError, 400);
      }
    } catch (e) {
      return serverError(res, e);
    }

    // Update the lead
    const updatedLead = await Lead.findByIdAndUpdate(
      id,
      { ...payload, updatedAt: new Date() },
      { new: true, runValidators: true }
    )
      .populate({
        path: 'createdBy',
        select: 'name email phone firmName userId',
        populate: {
          path: 'userId',
          select: '_id name email phone role'
        }
      })
      .populate({ path: 'primaryRegion', select: 'name state city description' })
      .populate({ path: 'secondaryRegion', select: 'name state city description' })
      .populate({
        path: 'transfers.fromBroker',
        select: 'name email phone firmName region',
        populate: { path: 'region', select: 'name state city description' }
      })
      .populate({
        path: 'transfers.toBroker',
        select: 'name email phone firmName region',
        populate: { path: 'region', select: 'name state city description' }
      });

    // Back-compat alias and transfer brokers' derived regions
    const leadUpdated = updatedLead && updatedLead.toObject ? updatedLead.toObject() : updatedLead;
    if (leadUpdated) {
      leadUpdated.region = leadUpdated.primaryRegion;
      if (Array.isArray(leadUpdated.transfers)) {
        leadUpdated.transfers = leadUpdated.transfers.map(t => {
          const tr = { ...t };
          if (tr.fromBroker && typeof tr.fromBroker === 'object') {
            const regions = Array.isArray(tr.fromBroker.region) ? tr.fromBroker.region : [];
            tr.fromBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
            tr.fromBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
          }
          if (tr.toBroker && typeof tr.toBroker === 'object') {
            const regions = Array.isArray(tr.toBroker.region) ? tr.toBroker.region : [];
            tr.toBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
            tr.toBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
          }
          return tr;
        });
      }
    }

    // Create notification if status changed
    if (payload.status && payload.status !== existingLead.status) {
      try {
        // Notify the lead creator
        if (updatedLead.createdBy?.userId) {
          const creatorUserId = updatedLead.createdBy.userId._id || updatedLead.createdBy.userId;
          await createLeadNotification(
            creatorUserId,
            'statusChanged',
            updatedLead,
            req.user
          );
        }
        // Notify brokers involved in transfers
        if (Array.isArray(updatedLead.transfers) && updatedLead.transfers.length > 0) {
          const brokerIds = [
            ...new Set(
              updatedLead.transfers
                .map(t => [t.fromBroker?._id || t.fromBroker, t.toBroker?._id || t.toBroker])
                .flat()
                .filter(Boolean)
            )
          ];
          await Promise.all(
            brokerIds.map(async (brokerId) => {
              const broker = await BrokerDetail.findById(brokerId).select('userId');
              if (broker?.userId) {
                const brokerUserId = broker.userId._id || broker.userId;
                await createLeadNotification(brokerUserId, 'statusChanged', updatedLead, req.user);
              }
            })
          );
        }
      } catch (notifError) {
        console.error('Error creating status change notification:', notifError);
      }
    }

    return successResponse(res, 'Lead updated successfully', { lead: leadUpdated });
  } catch (error) {
    // Duplicate key error from Mongo for unique indexes
    if (error?.code === 11000 && error?.keyPattern) {
      const fields = Object.keys(error.keyPattern).join(', ');
      return errorResponse(res, `Duplicate value for: ${fields}`, 409);
    }
    return serverError(res, error);
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if lead exists
    const lead = await Lead.findById(id);
    if (!lead) {
      return errorResponse(res, 'Lead not found', 404);
    }

    // Create notification before deleting
    try {
      // Notify admin users about lead deletion
      const admins = await User.find({ role: 'admin', status: 'active' }).select('_id');
      const adminIds = admins.map(admin => admin._id.toString());
      
      await Promise.all(
        admins.map(admin =>
          createLeadNotification(admin._id, 'deleted', lead, req.user)
        )
      );
      
      // Notify the lead creator (only if not already notified as admin)
      if (lead.createdBy) {
        const broker = await BrokerDetail.findById(lead.createdBy).select('userId');
        if (broker?.userId) {
          const brokerUserId = broker.userId._id || broker.userId;
          const brokerUserIdStr = brokerUserId.toString();
          const reqUserIdStr = req.user?._id?.toString();
          
          // Only notify if: not the same user AND not already notified as admin
          if (brokerUserIdStr !== reqUserIdStr && !adminIds.includes(brokerUserIdStr)) {
            await createLeadNotification(brokerUserId, 'deleted', lead, req.user);
          }
        }
      }
    } catch (notifError) {
      console.error('Error creating lead deletion notification:', notifError);
    }

    // Delete the lead
    await Lead.findByIdAndDelete(id);

    return successResponse(res, 'Lead deleted successfully');
  } catch (error) {
    return serverError(res, error);
  }
};

export const transferAndNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    
    const toBrokers = Array.isArray(body.toBrokers) ? body.toBrokers : [];
    const transferObjects = Array.isArray(body.transfers) ? body.transfers : [];
    const fromBroker = body.fromBroker;
    const notes = body.notes;

    // Determine fromBroker (prefer provided; else default to logged-in broker)
    let fromId = fromBroker || null;
    if (!fromId && req.user && req.user.role === 'broker') {
      fromId = await findBrokerDetailIdByUserId(req.user._id);
    }
    if (!fromId) {
      return errorResponse(res, 'fromBroker is required (or login as broker)', 400);
    }

    // Validate brokers
    const fromExists = await BrokerDetail.exists({ _id: fromId });
    if (!fromExists) return errorResponse(res, 'Invalid fromBroker: broker not found', 400);

    // Support both formats: toBrokers array (backward compatible) or transfers array (new format)
    let transfersToAdd = [];
    
    if (transferObjects && transferObjects.length > 0) {
      // New format: transfers array with shareType and region
      const Region = (await import('../models/Region.js')).default;
      for (const transfer of transferObjects) {
        const shareType = transfer.shareType || 'individual';
        
        // Validate based on shareType
        if (shareType === 'individual') {
          if (!transfer.toBroker) {
            return errorResponse(res, 'toBroker is required when shareType is "individual"', 400);
          }
          // Validate toBroker exists
          const toExists = await BrokerDetail.exists({ _id: transfer.toBroker });
          if (!toExists) {
            return errorResponse(res, `Invalid toBroker: ${transfer.toBroker} not found`, 400);
          }
          transfersToAdd.push({
            shareType: 'individual',
            toBroker: transfer.toBroker,
            region: null
          });
        } else if (shareType === 'region') {
          if (!transfer.region) {
            return errorResponse(res, 'region is required when shareType is "region"', 400);
          }
          // Validate region exists
          const regionExists = await Region.exists({ _id: transfer.region });
          if (!regionExists) {
            return errorResponse(res, `Invalid region: ${transfer.region} not found`, 400);
          }
          transfersToAdd.push({
            shareType: 'region',
            toBroker: null,
            region: transfer.region
          });
        } else if (shareType === 'all') {
          // For 'all', save only shareType (no toBroker, no region)
          transfersToAdd.push({
            shareType: 'all',
            toBroker: null,
            region: null
          });
        }
      }
    } else if (toBrokers && toBrokers.length > 0) {
      // Backward compatible format: toBrokers array (defaults to 'individual')
      const uniqueTo = [...new Set(toBrokers)];
      const toExistsCount = await BrokerDetail.countDocuments({ _id: { $in: uniqueTo } });
      if (toExistsCount !== uniqueTo.length) {
        return errorResponse(res, 'One or more toBrokers not found', 400);
      }
      
      transfersToAdd = uniqueTo.map(tb => ({
        shareType: 'individual',
        toBroker: tb,
        region: null
      }));
    } else {
      return errorResponse(res, 'Either toBrokers or transfers array is required', 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) return errorResponse(res, 'Lead not found', 404);

    // Append transfers without duplicates
    // For individual: check fromBroker + toBroker
    // For region: check fromBroker + shareType + region
    // For all: check fromBroker + shareType
    lead.transfers = Array.isArray(lead.transfers) ? lead.transfers : [];
    const existingTransfers = new Set();
    
    // Build set of existing transfer keys
    lead.transfers.forEach(t => {
      if (t.shareType === 'individual' && t.toBroker) {
        existingTransfers.add(`${String(t.fromBroker)}:individual:${String(t.toBroker)}`);
      } else if (t.shareType === 'region' && t.region) {
        existingTransfers.add(`${String(t.fromBroker)}:region:${String(t.region)}`);
      } else if (t.shareType === 'all') {
        existingTransfers.add(`${String(t.fromBroker)}:all`);
      }
    });
    
    const uniqueToBrokerIds = [];
    transfersToAdd.forEach(transfer => {
      let key;
      if (transfer.shareType === 'individual') {
        key = `${String(fromId)}:individual:${String(transfer.toBroker)}`;
      } else if (transfer.shareType === 'region') {
        key = `${String(fromId)}:region:${String(transfer.region)}`;
      } else {
        key = `${String(fromId)}:all`;
      }
      
      if (!existingTransfers.has(key)) {
        const newTransfer = {
          fromBroker: fromId,
          shareType: transfer.shareType
        };
        
        // Only add toBroker if shareType is 'individual'
        if (transfer.shareType === 'individual' && transfer.toBroker) {
          newTransfer.toBroker = transfer.toBroker;
          uniqueToBrokerIds.push(transfer.toBroker);
        }
        
        // Only add region if shareType is 'region'
        if (transfer.shareType === 'region' && transfer.region) {
          newTransfer.region = transfer.region;
        }
        
        lead.transfers.push(newTransfer);
        existingTransfers.add(key);
      }
    });

    // Update notes if provided
    if (notes !== undefined) {
      lead.notes = notes ?? '';
    }

    await lead.save();
    
    // Create notifications for transferred brokers
    try {
      const fromBroker = await BrokerDetail.findById(fromId).select('name userId').populate('userId', 'name');
      
      // Notifications for individual transfers (specific brokers)
      const individualNotifications = uniqueToBrokerIds.map(toBrokerId =>
        createTransferNotification(toBrokerId, fromId, lead, fromBroker?.userId || req.user)
      );
      
      // Notifications for region transfers (all brokers in that region)
      const regionTransferIds = transfersToAdd
        .filter(t => t.shareType === 'region' && t.region)
        .map(t => t.region);
      
      const regionNotifications = [];
      if (regionTransferIds.length > 0) {
        const brokersInRegions = await BrokerDetail.find({
          region: { $in: regionTransferIds },
          _id: { $ne: fromId } // Exclude the fromBroker
        }).select('userId').populate('userId', '_id');
        
        for (const broker of brokersInRegions) {
          if (broker.userId) {
            const userId = broker.userId._id || broker.userId;
            regionNotifications.push(
              createTransferNotification(broker._id, fromId, lead, fromBroker?.userId || req.user)
            );
          }
        }
      }
      
      // Notifications for 'all' transfers (all brokers in the system)
      const allTransferNotifications = [];
      const hasAllTransfer = transfersToAdd.some(t => t.shareType === 'all');
      if (hasAllTransfer) {
        const allBrokers = await BrokerDetail.find({
          _id: { $ne: fromId } // Exclude the fromBroker
        }).select('userId').populate('userId', '_id');
        
        for (const broker of allBrokers) {
          if (broker.userId) {
            allTransferNotifications.push(
              createTransferNotification(broker._id, fromId, lead, fromBroker?.userId || req.user)
            );
          }
        }
      }
      
      // Send all notifications
      await Promise.all([
        ...individualNotifications,
        ...regionNotifications,
        ...allTransferNotifications
      ]);
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error creating transfer notification:', notifError);
    }
    
    return successResponse(res, 'Transfer(s) and notes processed successfully', { lead });
  } catch (error) {
    return serverError(res, error);
  }
};

// Delete a specific transfer (from -> to) for a lead
export const deleteLeadTransfer = async (req, res) => {
  try {
    const { id, toBrokerId } = req.params;
    const { fromBrokerId } = req.query || {};

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return errorResponse(res, 'Invalid lead id', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(toBrokerId))) {
      return errorResponse(res, 'Invalid toBrokerId', 400);
    }

    // Resolve fromBroker: explicit param takes precedence, else logged-in broker
    let fromId = fromBrokerId || null;
    if (!fromId && req.user && req.user.role === 'broker') {
      try {
        fromId = await findBrokerDetailIdByUserId(req.user._id);
      } catch (_) { /* ignore */ }
    }
    if (!fromId) {
      return errorResponse(res, 'fromBrokerId is required (or login as broker)', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(fromId))) {
      return errorResponse(res, 'Invalid fromBrokerId', 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) return errorResponse(res, 'Lead not found', 404);

    const before = Array.isArray(lead.transfers) ? lead.transfers.length : 0;
    lead.transfers = (lead.transfers || []).filter(t => {
      const toMatch = String(t?.toBroker) === String(toBrokerId);
      const fromMatch = String(t?.fromBroker) === String(fromId);
      return !(toMatch && fromMatch);
    });
    const after = lead.transfers.length;

    if (after === before) {
      return errorResponse(res, 'Transfer entry not found for given from/to brokers', 404);
    }

    await lead.save();
    return successResponse(res, 'Transfer deleted successfully', { lead });
  } catch (error) {
    return serverError(res, error);
  }
};

// Update lead verification status (Admin only)
export const updateLeadVerification = async (req, res) => {
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

    // Find lead
    const lead = await Lead.findById(id);
    
    if (!lead) {
      return errorResponse(res, 'Lead not found', 404);
    }

    // Update verification status
    lead.verificationStatus = verificationStatus;
    await lead.save();

    // Get updated lead with populated data
    const updatedLead = await Lead.findById(id)
      .populate({
        path: 'createdBy',
        select: 'name email phone firmName brokerImage userId',
        populate: {
          path: 'userId',
          select: '_id name email phone role'
        }
      })
      .populate({ path: 'primaryRegion', select: 'name state city description' })
      .populate({ path: 'secondaryRegion', select: 'name state city description' })
      .populate({
        path: 'transfers.fromBroker',
        select: 'name email phone firmName brokerImage region',
        populate: { path: 'region', select: 'name state city description' }
      })
      .populate({
        path: 'transfers.toBroker',
        select: 'name email phone firmName brokerImage region',
        populate: { path: 'region', select: 'name state city description' }
      })
      .lean();

    // Convert brokerImage paths to URLs
    if (updatedLead.createdBy && typeof updatedLead.createdBy === 'object') {
      updatedLead.createdBy.brokerImage = getFileUrl(req, updatedLead.createdBy.brokerImage);
    }
    if (Array.isArray(updatedLead.transfers)) {
      updatedLead.transfers = updatedLead.transfers.map(t => {
        const tr = { ...t };
        if (tr.fromBroker && typeof tr.fromBroker === 'object') {
          tr.fromBroker.brokerImage = getFileUrl(req, tr.fromBroker.brokerImage);
          const regions = Array.isArray(tr.fromBroker.region) ? tr.fromBroker.region : [];
          tr.fromBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
          tr.fromBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
        }
        if (tr.toBroker && typeof tr.toBroker === 'object') {
          tr.toBroker.brokerImage = getFileUrl(req, tr.toBroker.brokerImage);
          const regions = Array.isArray(tr.toBroker.region) ? tr.toBroker.region : [];
          tr.toBroker.primaryRegion = regions.length > 0 ? regions[0] : null;
          tr.toBroker.secondaryRegion = regions.length > 1 ? regions[1] : null;
        }
        return tr;
      });
    }
    updatedLead.region = updatedLead.primaryRegion;

    return successResponse(res, `Lead verification status updated to ${verificationStatus}`, { 
      lead: updatedLead 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

export const getFullLeadsByBrokerId = async (req, res) => {
  try {
    const { brokerId } = req.params;
    const leads = await Lead.find({ createdBy: brokerId });
    return successResponse(res, 'Leads retrieved successfully', { leads });
  } catch (error) {
    return serverError(res, error);
  }
};
