import express from 'express';
import {
  subscribeEmail,
  getSubscriptions
} from '../controllers/emailSubscriptionController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Subscribe email (public endpoint)
router.post('/', subscribeEmail);

// Get all subscriptions with filters and pagination (authenticated - admin only)
router.get('/', authenticate, getSubscriptions);

export default router;

