import { Router } from "express";
import { 
  createProperty, 
  getProperties,
  getPropertyById, 
  approveProperty, 
  rejectProperty,
  getPropertyMetrics,
  updateProperty,
  deleteProperty
} from "../controllers/propertyController.js";
import { validate } from "../middleware/validation.js";
import { validateCreateProperty, validateUpdateProperty } from "../validations/property.js"
import { uploadPropertyMedia, handleUploadError } from "../middleware/upload.js";
import { authenticate } from "../middleware/auth.js";


const router = Router();

// POST /api/properties → create property (with validation)
router.get("/metrics", getPropertyMetrics);

router.post("/", uploadPropertyMedia, handleUploadError, validateCreateProperty, createProperty);

// GET /api/properties → list properties with filters + pagination
router.get("/", getProperties);
router.get("/:id", getPropertyById);

// Admin-only routes
router.patch("/:id/approve", authenticate, approveProperty);
router.patch("/:id/reject", authenticate, rejectProperty);

// Update and delete routes (authenticated - broker can update/delete their own, admin can do all)
router.put("/:id", authenticate, uploadPropertyMedia, handleUploadError, validateUpdateProperty, updateProperty);
router.delete("/:id", authenticate, deleteProperty);

export default router;
