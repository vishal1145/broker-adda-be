import Joi from 'joi';

export const createLeadSchema = Joi.object({
  customerName: Joi.string().optional(),
  customerPhone: Joi.string().optional(),
  customerEmail: Joi.string().email().optional(),
  requirement: Joi.string().optional(),
  propertyType: Joi.string().valid('Residential', 'Commercial', 'Plot', 'Other').optional(),
  budget: Joi.number().optional(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  status: Joi.string().valid('New', 'Assigned', 'In Progress', 'Closed', 'Rejected').optional(),
  transfers: Joi.array().items(Joi.object({
    fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    toBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
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
  requirement: Joi.string().max(200).optional(),
  budgetMin: Joi.number().min(0).optional(),
  budgetMax: Joi.number().min(0).optional(),
  createdBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  customerEmail: Joi.string().email().optional(),
  customerPhone: Joi.string().optional(),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
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
  toBrokers: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).min(1).required(),
  fromBroker: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  notes: Joi.string().allow('', null).optional()
});

