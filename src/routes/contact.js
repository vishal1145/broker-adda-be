import express from 'express';
import {
  createContact,
  getContacts
} from '../controllers/contactController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Create a new contact form submission (public endpoint)
router.post('/', createContact);

// Get all contacts with filters and pagination (authenticated)
router.get('/', authenticate, getContacts);

export default router;

