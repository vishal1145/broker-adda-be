import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import Chat from '../models/Chat.js';
import mongoose from 'mongoose';
import { getFileUrl } from '../middleware/upload.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { createLeadNotification, createTransferNotification, createAllBrokersTransferNotification, createRegionTransferNotification } from '../utils/notifications.js';
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
    // Check if createdBy exists in BrokerDetail
    const brokerExists = await BrokerDetail.exists({ _id: payload.createdBy });
    // Check if createdBy exists in User table with role='admin'
    const adminExists = await User.exists({ _id: payload.createdBy, role: 'admin' });
    
    if (!brokerExists && !adminExists) {
      return 'Invalid createdBy: broker or admin not found';
    }
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
    // Use userId from token (req.user._id)
    try {
      if (req.user?._id) {
        await createLeadNotification(req.user._id, 'created', lead, req.user);
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

    // First get original createdBy ObjectIds before populate
    const leadDocs = await Lead.find(filter)
      .select('_id createdBy')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();
    
    const createdByIdsMap = new Map();
    leadDocs.forEach(doc => {
      if (doc.createdBy) {
        createdByIdsMap.set(doc._id.toString(), doc.createdBy);
      }
    });

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

    // Handle admin-created leads: find leads with null createdBy and populate from User
    const adminCreatedLeadIds = [];
    items.forEach((lead, index) => {
      if (!lead.createdBy && createdByIdsMap.has(lead._id.toString())) {
        adminCreatedLeadIds.push({ index, createdById: createdByIdsMap.get(lead._id.toString()) });
      }
    });

    // Fetch admin users for leads with null createdBy (only if they exist as admin users)
    if (adminCreatedLeadIds.length > 0) {
      const adminUserIds = adminCreatedLeadIds.map(item => item.createdById);
      // Only fetch users that are confirmed to be admins
      const adminUsers = await User.find({ 
        _id: { $in: adminUserIds }, 
        role: 'admin' 
      })
        .select('_id name email phone role')
        .lean();
      
      const adminUsersMap = new Map();
      adminUsers.forEach(admin => {
        adminUsersMap.set(admin._id.toString(), admin);
      });

      // Assign admin data to leads only if confirmed as admin user
      adminCreatedLeadIds.forEach(({ index, createdById }) => {
        const adminUser = adminUsersMap.get(createdById.toString());
        if (adminUser && adminUser.role === 'admin') {
          items[index].createdBy = {
            _id: adminUser._id,
            name: adminUser.name || 'Admin',
            email: adminUser.email || null,
            phone: adminUser.phone || null,
            firmName: null,
            brokerImage: null,
            userId: {
              _id: adminUser._id,
              name: adminUser.name || 'Admin',
              email: adminUser.email || null,
              phone: adminUser.phone || null,
              role: 'admin'
            }
          };
        }
      });
    }

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
    
    // First get the original createdBy ObjectId before populate
    const leadDoc = await Lead.findById(id).select('createdBy').lean();
    if (!leadDoc) return errorResponse(res, 'Lead not found', 404);
    
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

    // Handle admin-created leads: if createdBy is null (populate failed), check if it's an admin user
    if (!lead.createdBy && leadDoc.createdBy) {
      // Only populate from User table if the ID exists as an admin user
      const adminUser = await User.findOne({ 
        _id: leadDoc.createdBy, 
        role: 'admin' 
      }).select('_id name email phone role').lean();
      
      if (adminUser) {
        // For admin, structure matches broker format
        // Top-level fields represent admin user data (no separate BrokerDetail)
        lead.createdBy = {
          _id: adminUser._id,
          name: adminUser.name || 'Admin',
          email: adminUser.email || null,
          phone: adminUser.phone || null,
          firmName: null,
          brokerImage: null,
          userId: {
            _id: adminUser._id,
            name: adminUser.name || 'Admin',
            email: adminUser.email || null,
            phone: adminUser.phone || null,
            role: 'admin'
          }
        };
      }
    }

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

    // First get original createdBy ObjectIds before populate
    const leadDocs = await Lead.find(finalFilter)
      .select('_id createdBy')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();
    
    const createdByIdsMap = new Map();
    leadDocs.forEach(doc => {
      if (doc.createdBy) {
        createdByIdsMap.set(doc._id.toString(), doc.createdBy);
      }
    });

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

    // Handle admin-created leads: find leads with null createdBy and populate from User
    const adminCreatedLeadIds = [];
    items.forEach((lead, index) => {
      if (!lead.createdBy && createdByIdsMap.has(lead._id.toString())) {
        adminCreatedLeadIds.push({ index, createdById: createdByIdsMap.get(lead._id.toString()) });
      }
    });

    // Fetch admin users for leads with null createdBy (only if they exist as admin users)
    if (adminCreatedLeadIds.length > 0) {
      const adminUserIds = adminCreatedLeadIds.map(item => item.createdById);
      // Only fetch users that are confirmed to be admins
      const adminUsers = await User.find({ 
        _id: { $in: adminUserIds }, 
        role: 'admin' 
      })
        .select('_id name email phone role')
        .lean();
      
      const adminUsersMap = new Map();
      adminUsers.forEach(admin => {
        adminUsersMap.set(admin._id.toString(), admin);
      });

      // Assign admin data to leads only if confirmed as admin user
      adminCreatedLeadIds.forEach(({ index, createdById }) => {
        const adminUser = adminUsersMap.get(createdById.toString());
        if (adminUser && adminUser.role === 'admin') {
          items[index].createdBy = {
            _id: adminUser._id,
            name: adminUser.name || 'Admin',
            email: adminUser.email || null,
            phone: adminUser.phone || null,
            firmName: null,
            brokerImage: null,
            userId: {
              _id: adminUser._id,
              name: adminUser.name || 'Admin',
              email: adminUser.email || null,
              phone: adminUser.phone || null,
              role: 'admin'
            }
          };
        }
      });
    }

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

/**
 * Calculate percentage change between two values
 * @param {number} current - Current period value
 * @param {number} previous - Previous period value
 * @returns {number} Percentage change (rounded to 1 decimal place)
 */
const calculatePercentageChange = (current, previous) => {
  if (previous === 0) {
    // If previous is 0 and current > 0, it's a 100% increase (new growth)
    // If both are 0, return 0%
    return current > 0 ? 100 : 0;
  }
  const change = ((current - previous) / previous) * 100;
  return Math.round(change * 10) / 10; // Round to 1 decimal place
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

    // Property filter for broker-scoped queries
    const propertyMatchBase = {};
    if (createdByBrokerId) {
      propertyMatchBase.broker = new mongoose.Types.ObjectId(String(createdByBrokerId));
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Date ranges for percentage calculation (last 30 days vs previous 30 days for more accurate comparison)
    const now = new Date();
    const endOfCurrentPeriod = new Date(now);
    endOfCurrentPeriod.setHours(23, 59, 59, 999);
    const startOfCurrentPeriod = new Date(now);
    startOfCurrentPeriod.setDate(now.getDate() - 30);
    startOfCurrentPeriod.setHours(0, 0, 0, 0);
    
    const endOfPreviousPeriod = new Date(startOfCurrentPeriod);
    endOfPreviousPeriod.setMilliseconds(endOfPreviousPeriod.getMilliseconds() - 1);
    const startOfPreviousPeriod = new Date(startOfCurrentPeriod);
    startOfPreviousPeriod.setDate(startOfPreviousPeriod.getDate() - 30);
    startOfPreviousPeriod.setHours(0, 0, 0, 0);

    // Resolve WHICH broker to use for transfer metrics (actor)
    // Priority: brokerId > createdBy > logged-in user
    let actorBrokerId = brokerId || null;
    
    // If brokerId not provided, use createdBy if available
    if (!actorBrokerId && createdByBrokerId) {
      actorBrokerId = createdByBrokerId;
    }
    
    // If still not set and user is logged in as broker, use their broker ID
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

    // Build connections filter - participants are BrokerDetail IDs (based on chatController usage)
    const connectionsMatchBase = createdByBrokerId 
      ? { participants: new mongoose.Types.ObjectId(String(createdByBrokerId)) } 
      : {};

    // Calculate all metrics including percentage changes
    const [
      totalLeads,
      totalLeadsCurrentPeriod,
      totalLeadsPreviousPeriod,
      newLeadsToday,
      convertedLeads,
      avgDealAgg,
      transfersToMeAgg,
      transfersByMeAgg,
      totalProperties,
      totalPropertiesCurrentPeriod,
      totalPropertiesPreviousPeriod,
      totalConnections,
      totalConnectionsCurrentPeriod,
      totalConnectionsPreviousPeriod
    ] = await Promise.all([
      // Total leads (all time)
      Lead.countDocuments(matchBase),
      // Total leads - current period (last 30 days)
      Lead.countDocuments({
        ...matchBase,
        createdAt: { $gte: startOfCurrentPeriod, $lte: endOfCurrentPeriod }
      }),
      // Total leads - previous period (previous 30 days)
      Lead.countDocuments({
        ...matchBase,
        createdAt: { $gte: startOfPreviousPeriod, $lte: endOfPreviousPeriod }
      }),
      // New leads today
      Lead.countDocuments({ ...matchBase, createdAt: { $gte: startOfToday, $lte: endOfToday } }),
      // Converted leads
      Lead.countDocuments({ ...matchBase, status: 'Closed' }),
      // Average deal size
      Lead.aggregate([
        { $match: { ...matchBase, status: 'Closed', budget: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$budget' } } },
        { $project: { _id: 0, avg: 1 } }
      ]),
      // Transfers to me (only individual transfers)
      actorBrokerId
        ? Lead.aggregate([
            { $unwind: '$transfers' },
            { 
              $match: { 
                'transfers.toBroker': new mongoose.Types.ObjectId(String(actorBrokerId)),
                'transfers.shareType': 'individual'
              } 
            },
            { $count: 'count' }
          ])
        : Promise.resolve([]),
      // Transfers by me (only individual transfers)
      actorBrokerId
        ? Lead.aggregate([
            { $unwind: '$transfers' },
            { 
              $match: { 
                'transfers.fromBroker': new mongoose.Types.ObjectId(String(actorBrokerId)),
                'transfers.shareType': 'individual'
              } 
            },
            { $count: 'count' }
          ])
        : Promise.resolve([]),
      // Total properties (all time)
      createdByBrokerId
        ? Property.countDocuments(propertyMatchBase)
        : Property.countDocuments(),
      // Total properties - current period (last 30 days)
      createdByBrokerId
        ? Property.countDocuments({
            ...propertyMatchBase,
            createdAt: { $gte: startOfCurrentPeriod, $lte: endOfCurrentPeriod }
          })
        : Property.countDocuments({
            createdAt: { $gte: startOfCurrentPeriod, $lte: endOfCurrentPeriod }
          }),
      // Total properties - previous period (previous 30 days)
      createdByBrokerId
        ? Property.countDocuments({
            ...propertyMatchBase,
            createdAt: { $gte: startOfPreviousPeriod, $lte: endOfPreviousPeriod }
          })
        : Property.countDocuments({
            createdAt: { $gte: startOfPreviousPeriod, $lte: endOfPreviousPeriod }
          }),
      // Total connections (chats) - all time (filtered by broker if createdBy provided)
      Chat.countDocuments(connectionsMatchBase),
      // Total connections - current period (last 30 days)
      Chat.countDocuments({
        ...connectionsMatchBase,
        createdAt: { $gte: startOfCurrentPeriod, $lte: endOfCurrentPeriod }
      }),
      // Total connections - previous period (previous 30 days)
      Chat.countDocuments({
        ...connectionsMatchBase,
        createdAt: { $gte: startOfPreviousPeriod, $lte: endOfPreviousPeriod }
      })
    ]);

    // Calculate percentage changes
    const totalLeadsPercentage = calculatePercentageChange(totalLeadsCurrentPeriod, totalLeadsPreviousPeriod);
    const totalPropertiesPercentage = calculatePercentageChange(totalPropertiesCurrentPeriod, totalPropertiesPreviousPeriod);
    const totalConnectionsPercentage = calculatePercentageChange(totalConnectionsCurrentPeriod, totalConnectionsPreviousPeriod);

    const averageDealSize = Array.isArray(avgDealAgg) && avgDealAgg.length > 0 ? avgDealAgg[0].avg : 0;
    const transfersToMe = Array.isArray(transfersToMeAgg) && transfersToMeAgg.length > 0 ? transfersToMeAgg[0].count : 0;
    const transfersByMe = Array.isArray(transfersByMeAgg) && transfersByMeAgg.length > 0 ? transfersByMeAgg[0].count : 0;

    return successResponse(res, 'Lead metrics retrieved successfully', {
      totalLeads,
      totalLeadsPercentageChange: totalLeadsPercentage,
      newLeadsToday,
      convertedLeads,
      averageDealSize,
      transfersToMe,
      transfersByMe,
      totalProperties,
      totalPropertiesPercentageChange: totalPropertiesPercentage,
      totalConnections,
      totalConnectionsPercentageChange: totalConnectionsPercentage
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

    // Get original createdBy ObjectId before update
    const originalCreatedBy = existingLead.createdBy;

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

    // Handle admin-created leads: if createdBy is null (populate failed), check if it's an admin user
    const leadUpdated = updatedLead && updatedLead.toObject ? updatedLead.toObject() : updatedLead;
    if (!leadUpdated.createdBy && originalCreatedBy) {
      // Only populate from User table if the ID exists as an admin user
      const adminUser = await User.findOne({ 
        _id: originalCreatedBy, 
        role: 'admin' 
      }).select('_id name email phone role').lean();
      
      if (adminUser) {
        leadUpdated.createdBy = {
          _id: adminUser._id,
          name: adminUser.name || 'Admin',
          email: adminUser.email || null,
          phone: adminUser.phone || null,
          firmName: null,
          userId: {
            _id: adminUser._id,
            name: adminUser.name || 'Admin',
            email: adminUser.email || null,
            phone: adminUser.phone || null,
            role: 'admin'
          }
        };
      }
    }
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
    // Use userId from token (req.user._id)
    if (payload.status && payload.status !== existingLead.status) {
      try {
        if (req.user?._id) {
          await createLeadNotification(req.user._id, 'statusChanged', updatedLead, req.user);
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
    // Use userId from token (req.user._id)
    try {
      if (req.user?._id) {
        await createLeadNotification(req.user._id, 'deleted', lead, req.user);
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
      // Get sender broker details for the notification message
      const fromBroker = await BrokerDetail.findById(fromId).select('name userId').populate('userId', 'name');
      if (!fromBroker) {
        console.error('FromBroker not found for transfer notification');
        throw new Error('FromBroker not found');
      }
      
      const senderName = fromBroker.name || 'Unknown Broker';
      
      // Collect all unique recipient broker IDs to avoid duplicates
      const recipientBrokerIds = new Set();
      
      // Add individual transfer broker IDs
      if (uniqueToBrokerIds && uniqueToBrokerIds.length > 0) {
        uniqueToBrokerIds.forEach(brokerId => {
          if (brokerId) {
            recipientBrokerIds.add(String(brokerId));
          }
        });
      }
      
      // Handle region transfers - create ONE notification per unique region ID
      const regionTransfers = transfersToAdd.filter(t => t.shareType === 'region' && t.region);
      if (regionTransfers.length > 0) {
        // Get unique region IDs
        const uniqueRegionIds = [...new Set(regionTransfers.map(t => String(t.region)).filter(Boolean))];
        
        if (uniqueRegionIds.length > 0) {
          console.log(`Creating ${uniqueRegionIds.length} region transfer notifications for regions:`, uniqueRegionIds);
          
          // Create one notification per unique region
          const regionNotifications = await Promise.all(
            uniqueRegionIds.map(regionId =>
              createRegionTransferNotification(regionId, fromId, lead, fromBroker)
            )
          );
          
          const successCount = regionNotifications.filter(r => r !== null).length;
          console.log(`Successfully created ${successCount} out of ${uniqueRegionIds.length} region transfer notifications`);
          
          // Don't create individual broker notifications for region transfers
          // We already created one notification per region
        }
      }
      
      // Handle "all brokers" transfer - create ONE notification (like lead creation)
      const hasAllTransfer = transfersToAdd.some(t => t.shareType === 'all');
      if (hasAllTransfer) {
        const allNotification = await createAllBrokersTransferNotification(fromId, lead, fromBroker);
        if (allNotification) {
          console.log('Successfully created single "all brokers" transfer notification');
        }
        // Don't create individual notifications for "all" - we already created one
        return;
      }
      
      // Convert Set to Array and create notifications for each unique recipient broker
      // (only for individual and region transfers)
      const uniqueRecipientIds = Array.from(recipientBrokerIds).filter(Boolean);
      
      if (uniqueRecipientIds.length === 0) {
        console.warn('No recipient brokers found for transfer notification');
        return;
      }
      
      console.log(`Creating ${uniqueRecipientIds.length} transfer notifications for brokers:`, uniqueRecipientIds);
      
      const notifications = uniqueRecipientIds.map(toBrokerId =>
        createTransferNotification(toBrokerId, fromId, lead, fromBroker)
      );
      
      // Send all notifications
      const results = await Promise.all(notifications);
      const successCount = results.filter(r => r !== null).length;
      console.log(`Successfully created ${successCount} out of ${notifications.length} transfer notifications`);
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error creating transfer notification:', notifError);
      console.error('Stack:', notifError.stack);
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

// Update region transfer for a lead (matches existing transfer pattern)
export const updateRegionTransfer = async (req, res) => {
  try {
    const { id, regionId } = req.params;
    const { region, fromBroker } = req.body;

    if (!region) {
      return errorResponse(res, 'region is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return errorResponse(res, 'Invalid lead id', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(regionId))) {
      return errorResponse(res, 'Invalid regionId parameter', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(region))) {
      return errorResponse(res, 'Invalid region id', 400);
    }

    // Resolve fromBroker: explicit param takes precedence, else logged-in broker
    let fromId = fromBroker || null;
    if (!fromId && req.user && req.user.role === 'broker') {
      try {
        fromId = await findBrokerDetailIdByUserId(req.user._id);
      } catch (_) { /* ignore */ }
    }
    if (!fromId) {
      return errorResponse(res, 'fromBroker is required (or login as broker)', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(fromId))) {
      return errorResponse(res, 'Invalid fromBroker id', 400);
    }

    // Validate new region exists
    const Region = (await import('../models/Region.js')).default;
    const regionExists = await Region.exists({ _id: region });
    if (!regionExists) {
      return errorResponse(res, 'Invalid region: region not found', 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return errorResponse(res, 'Lead not found', 404);
    }

    // Find region transfer using same pattern as existing system: fromBroker + shareType + region
    lead.transfers = Array.isArray(lead.transfers) ? lead.transfers : [];
    const transferIndex = lead.transfers.findIndex(t => {
      return t.shareType === 'region' && 
             t.region &&
             String(t.fromBroker) === String(fromId) && 
             String(t.region) === String(regionId);
    });

    if (transferIndex === -1) {
      return errorResponse(res, 'Region transfer not found for given fromBroker and region', 404);
    }

    // Check if new region transfer already exists (different from current one)
    if (String(regionId) !== String(region)) {
      const existingTransfer = lead.transfers.find(t => {
        return t.shareType === 'region' && 
               t.region &&
               String(t.fromBroker) === String(fromId) && 
               String(t.region) === String(region);
      });

      if (existingTransfer) {
        return errorResponse(res, 'Region transfer already exists for this new region', 409);
      }
    }

    // Update the transfer (same pattern as existing system)
    lead.transfers[transferIndex].region = region;
    lead.updatedAt = new Date();

    await lead.save();

    // Get updated lead with populated data (same as getLeadById)
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
      .populate({
        path: 'transfers.region',
        select: 'name state city description'
      })
      .lean();

    return successResponse(res, 'Region transfer updated successfully', { lead: updatedLead });
  } catch (error) {
    return serverError(res, error);
  }
};

// Delete region transfer for a lead (matches existing transfer pattern)
export const deleteRegionTransfer = async (req, res) => {
  try {
    const { id, regionId } = req.params;
    const { fromBroker } = req.query || {};

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return errorResponse(res, 'Invalid lead id', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(regionId))) {
      return errorResponse(res, 'Invalid regionId parameter', 400);
    }

    // Resolve fromBroker: explicit param takes precedence, else logged-in broker (same as deleteLeadTransfer)
    let fromId = fromBroker || null;
    if (!fromId && req.user && req.user.role === 'broker') {
      try {
        fromId = await findBrokerDetailIdByUserId(req.user._id);
      } catch (_) { /* ignore */ }
    }
    if (!fromId) {
      return errorResponse(res, 'fromBroker is required (or login as broker)', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(fromId))) {
      return errorResponse(res, 'Invalid fromBroker id', 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return errorResponse(res, 'Lead not found', 404);
    }

    // Delete using same pattern as existing system: fromBroker + shareType + region
    const before = Array.isArray(lead.transfers) ? lead.transfers.length : 0;
    lead.transfers = (lead.transfers || []).filter(t => {
      // Match region transfer: shareType='region' AND fromBroker matches AND region matches
      const isRegionTransfer = t.shareType === 'region' && t.region;
      const regionMatch = String(t.region) === String(regionId);
      const fromMatch = String(t.fromBroker) === String(fromId);
      return !(isRegionTransfer && regionMatch && fromMatch);
    });
    const after = lead.transfers.length;

    if (after === before) {
      return errorResponse(res, 'Region transfer not found for given fromBroker and region', 404);
    }

    await lead.save();

    // Get updated lead with populated data (same as getLeadById)
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
      .populate({
        path: 'transfers.region',
        select: 'name state city description'
      })
      .lean();

    return successResponse(res, 'Region transfer deleted successfully', { lead: updatedLead });
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

    // Get original createdBy ObjectId before update
    const originalCreatedBy = lead.createdBy;

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

    // Handle admin-created leads: if createdBy is null (populate failed), check if it's an admin user
    if (!updatedLead.createdBy && originalCreatedBy) {
      // Only populate from User table if the ID exists as an admin user
      const adminUser = await User.findOne({ 
        _id: originalCreatedBy, 
        role: 'admin' 
      }).select('_id name email phone role').lean();
      
      if (adminUser) {
        updatedLead.createdBy = {
          _id: adminUser._id,
          name: adminUser.name || 'Admin',
          email: adminUser.email || null,
          phone: adminUser.phone || null,
          firmName: null,
          brokerImage: null,
          userId: {
            _id: adminUser._id,
            name: adminUser.name || 'Admin',
            email: adminUser.email || null,
            phone: adminUser.phone || null,
            role: 'admin'
          }
        };
      }
    }

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
