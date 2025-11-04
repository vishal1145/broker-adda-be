import express from 'express';
import authRoutes from './auth.js';
import brokerRoutes from './broker.js';
import customerRoutes from './customer.js';
import regionRoutes from './regions.js';
import leadRoutes from './leads.js';
import propertyRoutes from './propertyRoutes.js';
import chatRoutes from './chat.js';
import notificationRoutes from './notifications.js';
import savedPropertyRoutes from './savedProperties.js';
const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/brokers', brokerRoutes);
router.use('/customers', customerRoutes);
router.use('/regions', regionRoutes);
router.use('/leads', leadRoutes);
router.use('/properties', propertyRoutes);
router.use('/chats', chatRoutes);
router.use('/notifications', notificationRoutes);
router.use('/saved-properties', savedPropertyRoutes);

export default router;


