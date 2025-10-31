import express from 'express';
import {
  getAllBrokers,
  getBrokerById,
  approveBroker,
  rejectBroker,
  updateBrokerVerification,
  
} from '../controllers/brokerController.js';
// removed auth for public access
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import {
  brokerApprovalSchema,
  brokerRejectionSchema,
  brokerQuerySchema
} from '../validations/broker.js';

const router = express.Router();
// Public access for broker routes

// Get all brokers with pagination and filtering (all roles allowed)
router.get('/', validate(brokerQuerySchema, 'query'), getAllBrokers);




// Get single broker details
router.get('/:id', getBrokerById);

// Approval/rejection are public now (no auth)
// Approve broker
router.patch('/:id/approve', validate(brokerApprovalSchema), approveBroker);

// Reject broker
router.patch('/:id/reject', validate(brokerRejectionSchema), rejectBroker);

// Update broker verification status (Admin only)
router.patch('/:id/verification', authenticate, updateBrokerVerification);



export default router;
