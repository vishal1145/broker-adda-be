import Joi from 'joi';

// Complete profile schema
export const completeProfileSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  name: Joi.string().required().min(2).max(50).trim(),
  email: Joi.string().email().required().lowercase(),
  brokerDetails: Joi.object({
    firmName: Joi.string().required().min(2).max(100).trim(),
    regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    kycDocs: Joi.object({
      aadhar: Joi.string().required(),
      pan: Joi.string().required(),
      gst: Joi.string().required()
    }).required()
  }).optional(),
  customerDetails: Joi.object({
    preferences: Joi.object({
      budgetMin: Joi.number().min(0).required(),
      budgetMax: Joi.number().min(0).required(),
      propertyType: Joi.array().items(
        Joi.string().valid('apartment', 'villa', 'plot', 'commercial', 'house')
      ).min(1).required(),
      region: Joi.array().items(
        Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
      ).min(1).required()
    }).required()
  }).unknown(true).optional()
});

// Broker detail validation
export const brokerDetailSchema = Joi.object({
  firmName: Joi.string().required().min(2).max(100).trim(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  kycDocs: Joi.object({
    aadhar: Joi.string().required(),
    pan: Joi.string().required(),
    gst: Joi.string().required()
  }).required()
});

// Customer detail validation
export const customerDetailSchema = Joi.object({
  preferences: Joi.object({
    budgetMin: Joi.number().min(0).required(),
    budgetMax: Joi.number().min(0).required(),
    propertyType: Joi.array().items(
      Joi.string().valid('apartment', 'villa', 'plot', 'commercial', 'house')
    ).min(1).required(),
    region: Joi.array().items(
      Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
    ).min(1).required()
  }).required()
}).unknown(true);
