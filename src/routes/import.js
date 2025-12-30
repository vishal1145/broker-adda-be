import express from 'express';
import { 
  importBrokersFromCSV,
  importPropertiesFromCSV,
  importLeadsFromCSV
} from '../controllers/importController.js';
import { uploadCSV, handleUploadError } from '../middleware/upload.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// ==================== BROKER IMPORT ====================

/**
 * @route   POST /api/import/brokers
 * @desc    Import brokers from CSV file
 * @access  Private (Admin only)
 */
router.post(
  '/brokers',
  authenticate,
  authorize('admin'),
  uploadCSV,
  handleUploadError,
  importBrokersFromCSV
);

// ==================== PROPERTY IMPORT ====================

/**
 * @route   POST /api/import/properties
 * @desc    Import properties from CSV file
 * @access  Private (Admin only)
 */
router.post(
  '/properties',
  authenticate,
  authorize('admin'),
  uploadCSV,
  handleUploadError,
  importPropertiesFromCSV
);

// ==================== LEAD IMPORT ====================

/**
 * @route   POST /api/import/leads
 * @desc    Import leads from CSV file
 * @access  Private (Admin only)
 */
router.post(
  '/leads',
  authenticate,
  authorize('admin'),
  uploadCSV,
  handleUploadError,
  importLeadsFromCSV
);

export default router;
