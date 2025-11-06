import Joi from 'joi';

// Property rating creation schema
export const createPropertyRatingSchema = Joi.object({
  propertyId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().messages({
    'string.pattern.base': 'Invalid property ID format'
  }),
  rating: Joi.number().integer().min(1).max(5).required().messages({
    'number.base': 'Rating must be a number',
    'number.integer': 'Rating must be an integer',
    'number.min': 'Rating must be at least 1',
    'number.max': 'Rating must be at most 5',
    'any.required': 'Rating is required'
  }),
  review: Joi.string().trim().max(1000).optional().allow('', null).messages({
    'string.max': 'Review cannot be more than 1000 characters'
  })
});

