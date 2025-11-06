import express from 'express';
import {
  createBrokerRating,
  getBrokerRatings,
  getCustomerRatingForBroker
} from '../controllers/brokerRatingController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { createBrokerRatingSchema } from '../validations/brokerRating.js';

const router = express.Router();

// Create/Save broker rating (requires authentication)
router.post('/', authenticate, validate(createBrokerRatingSchema), createBrokerRating);

// Get all ratings for a specific broker (public)
router.get('/broker/:brokerId', getBrokerRatings);

// Get customer's rating for a specific broker (requires authentication)
router.get('/broker/:brokerId/my-rating', authenticate, getCustomerRatingForBroker);

export default router;

