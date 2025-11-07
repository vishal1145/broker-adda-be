import express from 'express';
import {
  createPropertyRating,
  getPropertyRatings,
  getUserRatingForProperty,
  getAllPropertyAverageRatings
} from '../controllers/propertyRatingController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { createPropertyRatingSchema } from '../validations/propertyRating.js';

const router = express.Router();

// Create/Save property rating (requires authentication)
router.post('/', authenticate, validate(createPropertyRatingSchema), createPropertyRating);

// Get all properties with average ratings (public)
router.get('/all', getAllPropertyAverageRatings);

// Get all ratings for a specific property (public)
router.get('/property/:propertyId', getPropertyRatings);

// Get user's rating for a specific property (requires authentication)
router.get('/property/:propertyId/my-rating', authenticate, getUserRatingForProperty);

export default router;

