import Joi from 'joi';

// Experience schema
const experienceSchema = Joi.object({
  years: Joi.number().integer().min(0).max(50).optional(),
  description: Joi.string().trim().max(1000).optional(),
  achievements: Joi.array().items(
    Joi.string().trim().max(200)
  ).optional(),
  certifications: Joi.array().items(
    Joi.string().trim().max(200)
  ).optional()
});

// Broker update schema (for profile updates)
export const brokerUpdateSchema = Joi.object({
  name: Joi.string().trim().max(50).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  whatsappNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
  firmName: Joi.string().trim().max(100).optional(),
  licenseNumber: Joi.string().trim().max(50).optional(),
  address: Joi.string().trim().max(500).optional(),
  state: Joi.string().trim().max(50).optional(),
  city: Joi.string().trim().max(50).optional(),
  specializations: Joi.array().items(
    Joi.string().trim().max(100)
  ).optional(),
  website: Joi.string().trim().max(200).optional(),
  socialMedia: Joi.object({
    linkedin: Joi.string().trim().max(200).optional(),
    twitter: Joi.string().trim().max(200).optional(),
    instagram: Joi.string().trim().max(200).optional(),
    facebook: Joi.string().trim().max(200).optional()
  }).optional(),
  region: Joi.array().items(
    Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
  ).optional(),
  kycDocs: Joi.object({
    aadhar: Joi.string().optional(),
    pan: Joi.string().optional(),
    gst: Joi.string().optional(),
    brokerLicense: Joi.string().optional(),
    companyId: Joi.string().optional()
  }).optional(),
  brokerImage: Joi.string().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  approvedByAdmin: Joi.string().valid('blocked', 'unblocked').optional(),
  adminNotes: Joi.string().max(500).optional(),
  // New fields
  content: Joi.string().trim().max(2000).optional(),
  experience: experienceSchema.optional()
}).unknown(false);

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
  city: Joi.string().trim().optional(),
  regionCity: Joi.string().trim().optional(),
  regionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  search: Joi.string().max(100).optional(),
  // New query filters
  hasContent: Joi.boolean().optional(),
  minExperience: Joi.number().integer().min(0).optional(),
  maxExperience: Joi.number().integer().max(50).optional()
});
