import express from 'express';
import { createLead, getLeads, getLeadById, updateLead, deleteLead, transferAndNotes } from '../controllers/leadController.js';
import { validate } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { createLeadSchema, leadQuerySchema, transferAndNotesSchema } from '../validations/lead.js';

const router = express.Router();

// Create a new lead (no required fields, validation is permissive)
router.post('/', authenticate, validate(createLeadSchema), createLead);

// List leads with filters and pagination
router.get('/', authenticate, validate(leadQuerySchema, 'query'), getLeads);

// Get a single lead by id
router.get('/:id', authenticate, getLeadById);

// Update a lead
router.put('/:id', authenticate, updateLead);

// Delete a lead
router.delete('/:id', authenticate, deleteLead);

// Combined transfer + notes
router.post('/:id/transfer-and-notes', authenticate, validate(transferAndNotesSchema), transferAndNotes);

export default router;


