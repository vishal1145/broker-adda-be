import Joi from 'joi';

// Region validation
export const regionSchema = Joi.object({
  name: Joi.string().required().min(2).max(100).trim(),
  description: Joi.string().max(500).trim().optional()
});
