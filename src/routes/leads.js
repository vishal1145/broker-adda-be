import express from 'express';
import { createLead, getLeads, getLeadById, getLeadMetrics, updateLead, deleteLead, transferAndNotes, getTransferredLeads, deleteLeadTransfer } from '../controllers/leadController.js';
import { validate } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { createLeadSchema, updateLeadSchema, leadQuerySchema, transferAndNotesSchema, transferredLeadQuerySchema } from '../validations/lead.js';

const router = express.Router();

// Create a new lead (no required fields, validation is permissive)
router.post('/', authenticate, validate(createLeadSchema), createLead);

// List leads with filters and pagination
router.get('/', validate(leadQuerySchema, 'query'), getLeads);

// Lead metrics (totals for dashboard)
router.get('/metrics', getLeadMetrics);

// List only transferred leads, optionally filter by toBroker/fromBroker
router.get('/transferred', validate(transferredLeadQuerySchema, 'query'), getTransferredLeads);

// Get a single lead by id
router.get('/:id', getLeadById);

// Update a lead
router.put('/:id', authenticate, validate(updateLeadSchema), updateLead);

// Delete a lead
router.delete('/:id', authenticate, deleteLead);

// Combined transfer + notes
router.post('/:id/transfer-and-notes', authenticate, validate(transferAndNotesSchema), transferAndNotes);

// Delete a specific transfer (requires toBrokerId and fromBroker via query or logged-in broker)
router.delete('/:id/transfers/:toBrokerId', authenticate, deleteLeadTransfer);

export default router;


