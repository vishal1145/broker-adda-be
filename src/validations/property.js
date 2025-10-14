// src/validations/property.js
import Joi from "joi";

// Mongo ObjectId helper
const objectId = Joi.string().hex().length(24);

// Enums same as your Mongoose schema
const PROPERTY_TYPES = ["Residential", "Commercial", "Plot", "Other"];
const SUB_TYPES      = ["Apartment", "Villa", "Office", "Shop", "Land", "Other"];
const FURNISHINGS    = ["Furnished", "Semi-Furnished", "Unfurnished"];
const PRICE_UNITS    = ["INR", "USD"];
const STATUSES       = ["Active", "Sold", "Expired", "Pending Approval", "Rejected"];

// Nested schema
const coordinatesSchema = Joi.object({
  lat: Joi.number().min(-90).max(90),
  lng: Joi.number().min(-180).max(180),
}).unknown(false);

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
  city:         Joi.string().trim().default("Agra"),
  region:       Joi.string().trim().required(),
  coordinates:  coordinatesSchema,

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
