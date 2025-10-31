import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import mongoose from 'mongoose';
import { getFileUrl } from '../middleware/upload.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

// Helpers
const findBrokerDetailIdByUserId = async (userId) => {
  const broker = await BrokerDetail.findOne({ userId }).select('_id');
  return broker ? broker._id : null;
};

const applyBrokerDefaults = (payload, brokerDetailId) => {
  if (!brokerDetailId) return payload;

  const updated = { ...payload };

  if (!updated.createdBy) {
    updated.createdBy = brokerDetailId;
  }

  if (Array.isArray(updated.transfers)) {
    updated.transfers = updated.transfers.map(t => ({
      fromBroker: t?.fromBroker || brokerDetailId,
      toBroker: t?.toBroker
    }));
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
      requirement,
      budgetMin,
      budgetMax,
      createdBy,
      customerEmail,
      customerPhone,
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
    // Resolve region filter: match either primaryRegion or secondaryRegion
    const resolvedRegionId = regionId || region;
    // Optional city filter (case-insensitive) against customer address fields if present
    if (city) {
      const cityRegex = { $regex: `^${city}$`, $options: 'i' };
      // If your lead schema has a city field, filter directly; else apply to requirement/address text
      // Example applying to requirement text as fallback
      filter.$and = (filter.$and || []);
      filter.$and.push({ $or: [ { customerCity: cityRegex }, { requirement: { $regex: city, $options: 'i' } } ] });
    }
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

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    // Verification status filter
    if (verificationStatus) {
      filter.verificationStatus = verificationStatus;
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
        .populate({ path: 'createdBy', select: 'name email phone firmName brokerImage' })
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
      .populate({ path: 'createdBy', select: 'name email phone firmName brokerImage' })
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
    if (toBroker) {
      if (!mongoose.Types.ObjectId.isValid(String(toBroker))) {
        return errorResponse(res, 'Invalid toBroker format', 400);
      }
      matchTransfers['transfers.toBroker'] = new mongoose.Types.ObjectId(String(toBroker));
    }
    if (fromBroker) {
      if (!mongoose.Types.ObjectId.isValid(String(fromBroker))) {
        return errorResponse(res, 'Invalid fromBroker format', 400);
      }
      matchTransfers['transfers.fromBroker'] = new mongoose.Types.ObjectId(String(fromBroker));
    }
    if (brokerId) {
      if (!mongoose.Types.ObjectId.isValid(String(brokerId))) {
        return errorResponse(res, 'Invalid brokerId format', 400);
      }
      const brokerObjectId = new mongoose.Types.ObjectId(String(brokerId));
      matchTransfers.$or = [
        { 'transfers.fromBroker': brokerObjectId },
        { 'transfers.toBroker': brokerObjectId }
      ];
    }

    // If logged-in broker, filter to only show leads where they are involved in transfers
    if (req.user && req.user.role === 'broker') {
      try {
        const brokerDetailId = await findBrokerDetailIdByUserId(req.user._id);
        if (brokerDetailId) {
          matchTransfers.$or = [
            { 'transfers.fromBroker': brokerDetailId },
            { 'transfers.toBroker': brokerDetailId }
          ];
        }
      } catch (_) {
        // Non-fatal: continue without broker filter if lookup fails
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
        .populate({ path: 'createdBy', select: 'name email phone firmName brokerImage' })
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
      .populate({ path: 'createdBy', select: 'name email phone firmName' })
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
    const { toBrokers = [], fromBroker, notes } = req.body;

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

    const uniqueTo = [...new Set(toBrokers)];
    const toExistsCount = await BrokerDetail.countDocuments({ _id: { $in: uniqueTo } });
    if (toExistsCount !== uniqueTo.length) {
      return errorResponse(res, 'One or more toBrokers not found', 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) return errorResponse(res, 'Lead not found', 404);

    // Append transfers without duplicates (same fromBroker -> toBroker)
    lead.transfers = Array.isArray(lead.transfers) ? lead.transfers : [];
    const existingPairs = new Set(
      lead.transfers
        .filter(t => t?.fromBroker && t?.toBroker)
        .map(t => `${String(t.fromBroker)}:${String(t.toBroker)}`)
    );
    uniqueTo.forEach(tb => {
      const key = `${String(fromId)}:${String(tb)}`;
      if (!existingPairs.has(key)) {
        lead.transfers.push({ fromBroker: fromId, toBroker: tb });
        existingPairs.add(key);
      }
    });

    // Update notes if provided
    if (notes !== undefined) {
      lead.notes = notes ?? '';
    }

    await lead.save();
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
      .populate({ path: 'createdBy', select: 'name email phone firmName brokerImage' })
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


