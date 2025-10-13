import { Router } from "express";
import { createProperty, getProperties,getPropertyById, approveProperty, rejectProperty ,getPropertyMetrics } from "../controllers/propertyController.js";
import { validate } from "../middleware/validation.js";
import { validateCreateProperty } from "../validations/property.js"
import { uploadPropertyMedia, handleUploadError } from "../middleware/upload.js";


const router = Router();

// POST /api/properties → create property (with validation)
router.get("/metrics", getPropertyMetrics);

router.post("/", uploadPropertyMedia, handleUploadError, validateCreateProperty, createProperty);

// GET /api/properties → list properties with filters + pagination
router.get("/", getProperties);
router.get("/:id", getPropertyById);
router.patch("/:id/approve", approveProperty);
router.patch("/:id/reject",  rejectProperty);



export default router;
