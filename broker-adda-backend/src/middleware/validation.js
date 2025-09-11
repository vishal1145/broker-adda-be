import { errorResponse } from '../utils/response.js';

export const validate = (schema) => {
  return async (req, res, next) => {
    try {
      console.log('Validation middleware - validating request body:', req.body);
      const { error } = await schema.validateAsync(req.body);
      
      if (error) {
        console.log('Validation error:', error.details);
        const errorMessage = error.details.map(detail => detail.message).join(', ');
        return errorResponse(res, errorMessage, 400);
      }
      
      console.log('Validation passed successfully');
      next();
    } catch (error) {
      console.log('Validation middleware error:', error);
      return errorResponse(res, error.message, 400);
    }
  };
};



