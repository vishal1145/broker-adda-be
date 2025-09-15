import Joi from 'joi';

// Region validation
export const regionSchema = Joi.object({
  name: Joi.string().required().min(2).max(100).trim(),
  description: Joi.string().max(500).trim().optional(),
  state: Joi.string().required().min(2).max(50).trim(),
  city: Joi.string().required().min(2).max(50).trim(),
  centerLocation: Joi.string().required().min(2).max(500).trim(),
  radius: Joi.number().required()
});
