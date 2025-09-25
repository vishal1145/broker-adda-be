import Lead from '../models/Lead.js';
import mongoose from 'mongoose';
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

    // API-level uniqueness checks (only when values provided)
    if (payload.customerEmail) {
      const exists = await Lead.exists({ customerEmail: payload.customerEmail });
      if (exists) {
        return errorResponse(res, 'Customer email already exists for another lead', 409);
      }
    }
    if (payload.customerPhone) {
      const exists = await Lead.exists({ customerPhone: payload.customerPhone });
      if (exists) {
        return errorResponse(res, 'Customer phone already exists for another lead', 409);
      }
    }

    // Validate and map regionId -> region ObjectId
    if (!payload.region && payload.regionId) {
      payload.region = payload.regionId;
    }
    if (!payload.region) {
      return errorResponse(res, 'regionId is required', 400);
    }
    const Region = (await import('../models/Region.js')).default;
    const regionExists = await Region.exists({ _id: payload.region });
    if (!regionExists) {
      return errorResponse(res, 'Invalid regionId: region not found', 400);
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
    return successResponse(res, 'Lead created successfully', { lead }, 201);
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
      regionId,
      requirement,
      budgetMin,
      budgetMax,
      createdBy,
      customerEmail,
      customerPhone,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (createdBy) filter.createdBy = createdBy;
    // Resolve region filter strictly from regionId or region and cast to ObjectId
    const resolvedRegionId = regionId || region;
    if (resolvedRegionId) {
      const idAsString = String(resolvedRegionId);
      if (!mongoose.Types.ObjectId.isValid(idAsString)) {
        return errorResponse(res, 'Invalid regionId format', 400);
      }
      filter.region = new mongoose.Types.ObjectId(idAsString);
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

    const pageNum = Number.isFinite(parseInt(page)) && parseInt(page) > 0 ? parseInt(page) : 1;
    const limitNum = Number.isFinite(parseInt(limit)) && parseInt(limit) > 0 ? parseInt(limit) : 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [items, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate({ path: 'createdBy', select: 'name email phone firmName' })
        .populate({ path: 'region', select: 'name state city' })
        .lean(),
      Lead.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return successResponse(res, 'Leads retrieved successfully', {
      items,
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
      .populate({ path: 'createdBy', select: 'name email phone firmName' })
      .populate({ path: 'region', select: 'name state city description' })
      .populate({ path: 'transfers.fromBroker', select: 'name email phone firmName' })
      .populate({ path: 'transfers.toBroker', select: 'name email phone firmName' })
      .lean();

    if (!lead) return errorResponse(res, 'Lead not found', 404);

    return successResponse(res, 'Lead retrieved successfully', { lead });
  } catch (error) {
    return serverError(res, error);
  }
};

export const getLeadMetrics = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [totalLeads, newLeadsToday, convertedLeads, avgDealAgg] = await Promise.all([
      Lead.countDocuments({}),
      Lead.countDocuments({ createdAt: { $gte: startOfToday, $lte: endOfToday } }),
      Lead.countDocuments({ status: 'Closed' }),
      Lead.aggregate([
        { $match: { status: 'Closed', budget: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$budget' } } },
        { $project: { _id: 0, avg: 1 } }
      ])
    ]);

    const averageDealSize = Array.isArray(avgDealAgg) && avgDealAgg.length > 0 ? avgDealAgg[0].avg : 0;

    return successResponse(res, 'Lead metrics retrieved successfully', {
      totalLeads,
      newLeadsToday,
      convertedLeads,
      averageDealSize
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

    // Authorization check - only the creator or admin can update
    if (req.user && req.user.role === 'broker') {
      const brokerDetailId = await findBrokerDetailIdByUserId(req.user._id);
      if (existingLead.createdBy.toString() !== brokerDetailId?.toString()) {
        return errorResponse(res, 'Unauthorized: You can only update leads created by you', 403);
      }
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

    // Validate and map regionId -> region ObjectId
    if (payload.regionId) {
      payload.region = payload.regionId;
      delete payload.regionId;
    }
    
    if (payload.region) {
      const Region = (await import('../models/Region.js')).default;
      const regionExists = await Region.exists({ _id: payload.region });
      if (!regionExists) {
        return errorResponse(res, 'Invalid regionId: region not found', 400);
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
      .populate({ path: 'region', select: 'name state city description' })
      .populate({ path: 'transfers.fromBroker', select: 'name email phone firmName' })
      .populate({ path: 'transfers.toBroker', select: 'name email phone firmName' });

    return successResponse(res, 'Lead updated successfully', { lead: updatedLead });
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

    // Authorization check - only the creator or admin can delete
    if (req.user && req.user.role === 'broker') {
      const brokerDetailId = await findBrokerDetailIdByUserId(req.user._id);
      if (lead.createdBy.toString() !== brokerDetailId?.toString()) {
        return errorResponse(res, 'Unauthorized: You can only delete leads created by you', 403);
      }
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


