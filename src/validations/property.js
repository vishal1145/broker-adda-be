// src/validations/property.js
import Joi from "joi";

// Mongo ObjectId helper (strict 24-hex)
const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).messages({
  'string.pattern.base': 'Invalid ObjectId format'
});

// Enums same as your Mongoose schema
const PROPERTY_TYPES = ["Residential", "Commercial", "Plot", "Other"];
const SUB_TYPES      = ["Apartment", "Villa", "Office", "Shop", "Land", "Other"];
const FURNISHINGS    = ["Furnished", "Semi-Furnished", "Unfurnished"];
const PRICE_UNITS    = ["INR", "USD"];
const STATUSES       = ["Active", "Sold", "Expired", "Pending Approval", "Rejected"];

// Removed coordinates schema

// ✅ Create Property schema
export const createPropertySchema = Joi.object({
  // Basic
  title:        Joi.string().trim().min(3).max(200).required(),
  description:  Joi.string().allow("", null),
  propertyDescription: Joi.string().allow("", null),

  // Type & category
  propertyType: Joi.string().valid(...PROPERTY_TYPES).required(),
  subType:      Joi.string().valid(...SUB_TYPES).allow("", null),

  // Pricing
  price:        Joi.number().positive().required(),
  priceUnit:    Joi.string().valid(...PRICE_UNITS).default("INR"),
  propertySize: Joi.number().positive().optional(),

  // Location
  address:      Joi.string().trim().required(),
  city:         Joi.string().trim(),
  region:       objectId.required(),
  

  // Details
  bedrooms:     Joi.number().integer().min(0),
  bathrooms:    Joi.number().integer().min(0),
  furnishing:   Joi.string().valid(...FURNISHINGS),
  amenities:    Joi.array().items(Joi.string().trim()).default([]),
  nearbyAmenities: Joi.array().items(Joi.string().trim()).default([]),
  features:     Joi.array().items(Joi.string().trim()).default([]),
  locationBenefits: Joi.array().items(Joi.string().trim()).default([]),

  // Media
  images:       Joi.array().items(Joi.string().uri().allow("")) .default([]),
  videos:       Joi.array().items(Joi.string().uri().allow("")) .default([]),

  // Ownership
  broker:       objectId.required(),   // BrokerDetail _id

  // Status & workflow
  status:       Joi.string().valid(...STATUSES).default("Pending Approval"),
  isFeatured:   Joi.boolean().default(false),

  // Extra
  notes:        Joi.string().max(2000).allow("", null),

  // Listing meta (optional)
  facingDirection: Joi.string().valid("North","East","South","West"),
  possessionStatus: Joi.string().valid("Ready to Move","Under Construction","Upcoming"),
  postedBy: Joi.string().valid("Broker","Builder","Owner","Admin"),
  verificationStatus: Joi.string().valid("Verified","Unverified").default("Unverified"),
  propertyAgeYears: Joi.number().integer().min(0),
}).unknown(false);

// Small middleware helper
export const validate = (schema, where = "body") => (req, res, next) => {
  const { error, value } = schema.validate(req[where], {
    abortEarly: false,
    stripUnknown: true, // remove extra fields
    convert: true,       // "123" -> 123, "true" -> true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      details: error.details.map(d => ({ message: d.message, path: d.path })),
    });
  }
  req[where] = value;
  next();
};

// Ready-to-use middleware for create
export const validateCreateProperty = validate(createPropertySchema, "body");
