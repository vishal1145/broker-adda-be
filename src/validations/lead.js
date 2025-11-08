import Joi from 'joi';

export const createLeadSchema = Joi.object({
  customerName: Joi.string().optional(),
  customerPhone: Joi.string().optional(),
  customerEmail: Joi.string().email().optional(),
  requirement: Joi.string().optional(),
  propertyType: Joi.string().valid('Residential', 'Commercial', 'Plot', 'Other').optional(),
  budget: Joi.number().optional(),
  // Require primary, optional secondary (empty allowed)
  primaryRegionId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      'any.required': 'primaryRegionId is required',
      'string.pattern.base': 'primaryRegionId must be a valid 24-char hex ObjectId'
    }),
  secondaryRegionId: Joi.alternatives().try(
    Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    Joi.string().valid(''),
    Joi.allow(null)
  ).optional()
  .messages({ 'string.pattern.base': 'secondaryRegionId must be a valid 24-char hex ObjectId' }),
  // Back-compat: still accept regionId but will be mapped to primaryRegion
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  status: Joi.string().valid('New', 'Assigned', 'In Progress', 'Closed', 'Rejected').optional(),
  transfers: Joi.array().items(Joi.object({
    fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    shareType: Joi.string().valid('individual', 'region', 'all').optional(),
    region: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().allow(null),
  })).optional(),
  notes: Joi.string().optional(),
}).unknown(true);


export const updateLeadSchema = Joi.object({
  customerName: Joi.string().optional(),
  customerPhone: Joi.string().optional(),
  customerEmail: Joi.string().email().optional(),
  requirement: Joi.string().optional(),
  propertyType: Joi.string().valid('Residential', 'Commercial', 'Plot', 'Other').optional(),
  budget: Joi.number().optional(),
  // For updates, primaryRegionId is optional but if present must be valid
  primaryRegionId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({ 'string.pattern.base': 'primaryRegionId must be a valid 24-char hex ObjectId' })
    .optional(),
  secondaryRegionId: Joi.alternatives().try(
    Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    Joi.string().valid(''),
    Joi.allow(null)
  ).optional()
  .messages({ 'string.pattern.base': 'secondaryRegionId must be a valid 24-char hex ObjectId' }),
  // Back-compat
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  status: Joi.string().valid('New', 'Assigned', 'In Progress', 'Closed', 'Rejected').optional(),
  transfers: Joi.array().items(Joi.object({
    fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    shareType: Joi.string().valid('individual', 'region', 'all').optional(),
    region: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().allow(null),
  })).optional(),
  notes: Joi.string().optional(),
}).unknown(true);


export const leadQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().max(100).optional(),
  status: Joi.string().valid('New', 'Assigned', 'In Progress', 'Closed', 'Rejected').optional(),
  propertyType: Joi.string().valid('Residential', 'Commercial', 'Plot', 'Other').optional(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  primaryRegionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  secondaryRegionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  city: Joi.string().trim().optional(),
  regionCity: Joi.string().trim().optional(),
  region: Joi.string().trim().optional(),
  requirement: Joi.string().max(200).optional(),
  budgetMin: Joi.number().min(0).optional(),
  budgetMax: Joi.number().min(0).optional(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  customerEmail: Joi.string().email().optional(),
  customerPhone: Joi.string().optional(),
  dateRange: Joi.string().valid('today', 'last7days', 'last30days').optional(),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  verificationStatus: Joi.string().valid('Verified', 'Unverified').optional(),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'customerName', 'status').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});

export const transferredLeadQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().max(100).optional(),
  status: Joi.string().valid('New', 'Assigned', 'In Progress', 'Closed', 'Rejected').optional(),
  propertyType: Joi.string().valid('Residential', 'Commercial', 'Plot', 'Other').optional(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  region: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  requirement: Joi.string().max(200).optional(),
  budgetMin: Joi.number().min(0).optional(),
  budgetMax: Joi.number().min(0).optional(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  customerEmail: Joi.string().email().optional(),
  customerPhone: Joi.string().optional(),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  brokerId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'customerName', 'status').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});

export const addTransferSchema = Joi.object({
  toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional()
});

export const updateNotesSchema = Joi.object({
  notes: Joi.string().allow('', null).required()
});

export const transferAndNotesSchema = Joi.object({
  toBrokers: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).min(1).optional(),
  transfers: Joi.array().items(Joi.object({
    shareType: Joi.string().valid('individual', 'region', 'all').required(),
    toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).when('shareType', {
      is: 'individual',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null)
    }),
    region: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).when('shareType', {
      is: 'region',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null)
    }),
  }).unknown(true)).min(1).optional(),
  fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  notes: Joi.string().allow('', null).optional()
}).unknown(true).or('toBrokers', 'transfers');

export const updateRegionTransferSchema = Joi.object({
  region: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional()
});

