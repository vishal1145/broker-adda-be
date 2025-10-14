import Joi from 'joi';

// Complete profile schema with file upload support
export const completeProfileSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  name: Joi.string().required().min(2).max(50).trim(),
  email: Joi.string().email().required().lowercase(),
  // Optional top-level aliases for broker content/experience
  content: Joi.string().max(2000).trim().optional(),
  aboutUs: Joi.string().max(2000).trim().optional(),
  experienceYears: Joi.number().integer().min(0).max(50).optional(),
  experienceDescription: Joi.string().max(1000).trim().optional(),
  achievements: Joi.array().items(Joi.string().max(200).trim()).optional(),
  certifications: Joi.array().items(Joi.string().max(200).trim()).optional(),
  brokerDetails: Joi.object({
    gender: Joi.string().valid('male', 'female', 'other').required(),
    firmName: Joi.string().required().min(2).max(100).trim(),
    licenseNumber: Joi.string().optional().max(50).trim(),
    address: Joi.string().optional().max(500).trim(),
    state: Joi.string().optional().max(50).trim(),
    city: Joi.string().optional().max(50).trim(),
    whatsappNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
    specializations: Joi.array().items(
      Joi.string().max(100).trim()
    ).optional(),
    website: Joi.string().uri().optional().max(200).trim(),
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
      gst: Joi.string().optional(),
      brokerLicense: Joi.string().optional(),
      companyId: Joi.string().optional()
    }).optional(),
    // Optional content/about fields
    aboutUs: Joi.string().max(2000).trim().optional(),
    content: Joi.string().max(2000).trim().optional(),
    // Experience: full structure supported
    experienceYears: Joi.number().integer().min(0).max(50).optional(),
    experienceDescription: Joi.string().max(1000).trim().optional(),
    achievements: Joi.array().items(Joi.string().max(200).trim()).optional(),
    certifications: Joi.array().items(Joi.string().max(200).trim()).optional()
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
  whatsappNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  specializations: Joi.array().items(
    Joi.string().max(100).trim()
  ).optional(),
  website: Joi.string().uri().optional().max(200).trim(),
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
    gst: Joi.string().required(),
    brokerLicense: Joi.string().optional(),
    companyId: Joi.string().optional()
  }).required(),
  // About Us field - 1-2 lines only
  aboutUs: Joi.string().max(200).trim().optional(),
  // Experience field - format like "3 years", "5 years 9 months"
  experience: Joi.string()
    .max(100)
    .trim()
    .pattern(/^(\d+)\s*years?\s*(\d+)\s*months?$|^(\d+)\s*years?$/i)
    .optional()
    .messages({
      'string.pattern.base': 'Experience must be in format like "3 years" or "5 years 9 months"'
    })
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
