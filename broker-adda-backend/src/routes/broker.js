import express from 'express';
import {
  getAllBrokers,
  getBrokerById,
  approveBroker,
  rejectBroker
} from '../controllers/brokerController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import {
  brokerApprovalSchema,
  brokerRejectionSchema,
  brokerQuerySchema
} from '../validations/broker.js';

const router = express.Router();
// All other routes require admin authentication
router.use(authenticate);

// Get all brokers with pagination and filtering (all roles allowed)
router.get('/', validate(brokerQuerySchema, 'query'), getAllBrokers);




// Get single broker details
router.get('/:id', getBrokerById);

router.use(authorize('admin'));
// Approve broker
router.patch('/:id/approve', validate(brokerApprovalSchema), approveBroker);

// Reject broker
router.patch('/:id/reject', validate(brokerRejectionSchema), rejectBroker);

export default router;
