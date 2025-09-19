import Joi from 'joi';

// Complete profile schema with file upload support
export const completeProfileSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  name: Joi.string().required().min(2).max(50).trim(),
  email: Joi.string().email().required().lowercase(),
  brokerDetails: Joi.object({
    gender: Joi.string().valid('male', 'female', 'other').required(),
    firmName: Joi.string().required().min(2).max(100).trim(),
    licenseNumber: Joi.string().optional().max(50).trim(),
    address: Joi.string().optional().max(500).trim(),
    state: Joi.string().optional().max(50).trim(),
    city: Joi.string().optional().max(50).trim(),
    specializations: Joi.array().items(
      Joi.string().max(100).trim()
    ).optional(),
    socialMedia: Joi.object({
      linkedin: Joi.string().uri().optional().max(200).trim(),
      twitter: Joi.string().uri().optional().max(200).trim(),
      instagram: Joi.string().uri().optional().max(200).trim(),
      facebook: Joi.string().uri().optional().max(200).trim()
    }).optional(),
    region: Joi.array().items(
      Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
    ).min(1).required(),
    kycDocs: Joi.object({
      aadhar: Joi.string().optional(),
      pan: Joi.string().optional(),
      gst: Joi.string().optional()
    }).optional()
  }).optional(),
  customerDetails: Joi.object({
    gender: Joi.string().valid('male', 'female', 'other').required(),
    preferences: Joi.object({
      budgetMin: Joi.number().min(0).required(),
      budgetMax: Joi.number().min(0).required(),
      propertyType: Joi.array().items(
        Joi.string().valid('apartment', 'villa', 'plot', 'commercial', 'house')
      ).min(1).required(),
      region: Joi.array().items(
        Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
      ).optional()
    }).required()
  }).unknown(true).optional(),
  // File upload fields (handled by multer, validated here as optional)
  aadhar: Joi.any().optional(),
  pan: Joi.any().optional(),
  gst: Joi.any().optional(),
  brokerImage: Joi.any().optional(),
  customerImage: Joi.any().optional()
});


// Broker detail validation
export const brokerDetailSchema = Joi.object({
  gender: Joi.string().valid('male', 'female', 'other').required(),
  firmName: Joi.string().required().min(2).max(100).trim(),
  licenseNumber: Joi.string().optional().max(50).trim(),
  officeAddress: Joi.string().optional().max(500).trim(),
  state: Joi.string().optional().max(50).trim(),
  city: Joi.string().optional().max(50).trim(),
  specializations: Joi.array().items(
    Joi.string().max(100).trim()
  ).optional(),
  socialMedia: Joi.object({
    linkedin: Joi.string().uri().optional().max(200).trim(),
    twitter: Joi.string().uri().optional().max(200).trim(),
    instagram: Joi.string().uri().optional().max(200).trim(),
    facebook: Joi.string().uri().optional().max(200).trim()
  }).optional(),
  regionId: Joi.array()
    .items(
      Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/) // MongoDB ObjectId regex
        .required()
    )
    .min(1) // must have at least one regionId
    .required(),
  kycDocs: Joi.object({
    aadhar: Joi.string().required(),
    pan: Joi.string().required(),
    gst: Joi.string().required()
  }).required()
});

// Customer detail validation
export const customerDetailSchema = Joi.object({
  gender: Joi.string().valid('male', 'female', 'other').required(),
  preferences: Joi.object({
    budgetMin: Joi.number().min(0).required(),
    budgetMax: Joi.number().min(0).required(),
    propertyType: Joi.array().items(
      Joi.string().valid('apartment', 'villa', 'plot', 'commercial', 'house')
    ).min(1).required(),
    region: Joi.array().items(
      Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
    ).optional()
  }).required()
}).unknown(true);
