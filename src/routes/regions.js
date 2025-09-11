import express from 'express';
import {
  getAllRegions,
  getRegionById,
  createRegion,
  updateRegion,
  deleteRegion
} from '../controllers/regionController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { regionSchema } from '../validations/region.js';

const router = express.Router();

// Public routes
router.get('/', getAllRegions);
router.get('/:id', getRegionById);

// Protected routes (Admin only)
router.post('/', authenticate, validate(regionSchema), createRegion);
router.put('/:id', authenticate, validate(regionSchema), updateRegion);
router.delete('/:id', authenticate, deleteRegion);

export default router;