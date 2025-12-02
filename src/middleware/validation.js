import { errorResponse } from '../utils/response.js';

export const validate = (schema, source = 'body') => {
  return async (req, res, next) => {
    try {
      const dataToValidate = source === 'query' ? req.query : req.body;
      console.log(`Validation middleware - validating request ${source}:`, dataToValidate);
      
      const { error } = await schema.validateAsync(dataToValidate, {
        allowUnknown: true,
        stripUnknown: false,
        abortEarly: false
      });
      
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



