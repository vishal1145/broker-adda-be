import express from "express";
import upload from "../middleware/upload.js";
import { createPropertyAd, getAllAds,updatePropertyAd,deletePropertyAd,getAdById } from "../controllers/propertyAdController.js";


const router = express.Router();

// CREATE PROPERTY AD
router.post("/ads", upload.array("media", 10), createPropertyAd);

// GET PROPERTY ADS
router.get("/ads", getAllAds);
router.get("/ads/:id", getAdById);
router.put("/ads/:id", upload.array("media", 10), updatePropertyAd);
router.delete("/ads/:id", deletePropertyAd);
export default router;
