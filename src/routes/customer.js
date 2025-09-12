import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getAllCustomers, getCustomerById } from '../controllers/customerController.js';

const router = express.Router();

// Customer API - works for any role (admin, broker, customer)
router.get('/', authenticate, getAllCustomers);
router.get('/:customerId', authenticate, getCustomerById);

export default router;
