import express from 'express';
import authRoutes from './auth.js';
import brokerRoutes from './broker.js';
import regionRoutes from './regions.js';

const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/brokers', brokerRoutes);
router.use('/regions', regionRoutes);

export default router;


