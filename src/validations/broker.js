import Joi from 'joi';

// Broker approval schema
export const brokerApprovalSchema = Joi.object({});

// Broker rejection schema
export const brokerRejectionSchema = Joi.object({});


// Broker query parameters schema
export const brokerQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid('active', 'inactive').optional(),
  approvedByAdmin: Joi.string().valid('blocked', 'unblocked').optional(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  search: Joi.string().max(100).optional()
});
