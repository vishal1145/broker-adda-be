import express from 'express';
import {
  saveProperty,
  getSavedProperties,
  removeSavedProperty,
  checkIfSaved,
  getSavedPropertyCount
} from '../controllers/savedPropertyController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Save a property
router.post('/', saveProperty);

// Get all saved properties with pagination
router.get('/', getSavedProperties);

// Get saved property count
router.get('/count', getSavedPropertyCount);

// Check if property is saved
router.get('/check/:propertyId', checkIfSaved);

// Remove a saved property
router.delete('/:propertyId', removeSavedProperty);

export default router;

