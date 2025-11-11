// src/controllers/propertyController.js
import mongoose from "mongoose";
import Property from "../models/Property.js";
import PropertyRating from "../models/PropertyRating.js";
import BrokerDetail from "../models/BrokerDetail.js"; // ✅ correct model
import Region from "../models/Region.js";
import { getFileUrl } from "../middleware/upload.js";
import { createPropertyNotification, createNotification, getUserIdFromBrokerOrProperty } from "../utils/notifications.js";
import User from "../models/User.js";

export const createProperty = async (req, res) => {
  try {
    const {
      title, description, propertyDescription, propertySize,
      propertyType, subType, price, priceUnit,
      address, city, region, bedrooms, bathrooms,
      furnishing, amenities, nearbyAmenities, features, locationBenefits,
      images, videos,
      // listing meta (optional)
      facingDirection,
      possessionStatus,
      postedBy,
      verificationStatus,
      propertyAgeYears,
      broker,                   // must be a BrokerDetail _id (not User id)
      isFeatured, notes,status,
    } = req.body;

    // If caller is a broker, override with token value (optional)
    let brokerId = broker;
    if (req.user?.role === "broker") brokerId = req.user.brokerId;

    // 1) basic format check (prevents CastError 500s)
    if (!brokerId || !mongoose.isValidObjectId(brokerId)) {
      return res.status(400).json({ success: false, message: "Valid broker id is required." });
    }

    // 2) existence check in BrokerDetail
    const exists = await BrokerDetail.exists({ _id: brokerId });
    
    if (!exists) return res.status(404).json({ success: false, message: "Broker not found." });

    // 3) Validate region as ObjectId and ensure it exists
    const regionId = region;
    if (!regionId || !mongoose.isValidObjectId(regionId)) {
      return res.status(400).json({ success: false, message: "Valid region id is required." });
    }
    const regionExists = await Region.exists({ _id: regionId });
    if (!regionExists) {
      return res.status(404).json({ success: false, message: "Region not found." });
    }

    // 4) merge uploaded media with any URLs provided in body
    // Support both 'images' and 'images[]' (same for videos)
    const rawImages = [
      ...(req.files?.images || []),
      ...(req.files?.['images[]'] || [])
    ];
    const rawVideos = [
      ...(req.files?.videos || []),
      ...(req.files?.['videos[]'] || [])
    ];

    const uploadedImages = rawImages.map(f => getFileUrl(req, f.path));
    const uploadedVideos = rawVideos.map(f => getFileUrl(req, f.path));

    const bodyImages = Array.isArray(images) ? images : (images ? [images] : []);
    const bodyVideos = Array.isArray(videos) ? videos : (videos ? [videos] : []);

    const finalImages = [...bodyImages, ...uploadedImages];
    const finalVideos = [...bodyVideos, ...uploadedVideos];

    // 5) create
    const doc = await Property.create({
      title, description, propertyDescription, propertySize,
      propertyType, subType, price, priceUnit,
      address, city, region: regionId, bedrooms, bathrooms,
      furnishing, amenities, nearbyAmenities, features, locationBenefits,
      images: finalImages,
      videos: finalVideos,
      broker: brokerId,
      isFeatured: !!isFeatured,
      notes,
      status, // ✅ added
      // listing meta
      facingDirection,
      possessionStatus,
      postedBy,
      verificationStatus,
      propertyAgeYears,
    });
    // 6) return with populated broker and region info
    const created = await Property.findById(doc._id)
      .populate("broker", "name email phone firmName licenseNumber status")
      .populate("region", "name description city state centerLocation radius")
      .lean();

    // Create notification for property creation
    // Send notification to the broker who owns the property
    try {
      // Use the brokerId directly (ObjectId) instead of trying to extract from populated object
      const brokerUserId = await getUserIdFromBrokerOrProperty(brokerId, null);
      if (brokerUserId) {
        await createPropertyNotification(brokerUserId, 'created', created, req.user);
      } else {
        console.warn('Could not find broker userId for property creation notification');
      }
    } catch (notifError) {
      console.error('Error creating property notification:', notifError);
    }

    return res.status(201).json({ success: true, message: "Property created successfully.", data: created });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Validation failed.", details: err.errors });
    }
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};


export const getProperties = async (req, res) => {
  try {
    // ---- Query params (strings from URL) ----
    const {
      // pagination
      page ,
      limit,

      // seach + filters
      search,                 // matches title/description/address
      city,
      // region (string) is no longer supported for ObjectId-based region; use regionId instead
      region,
      propertyType,
      subType,
      furnishing,
      isFeatured,             // "true" | "false"
      bedrooms,               // exact number
      bathrooms,              // exact number
      minPrice,
      maxPrice,
      status,                 // 👈 NEW: filter by property status
      brokerId,               // 👈 NEW: filter by broker (BrokerDetail _id), supports comma-separated
      regionId,               // 👈 NEW: filter by region ID
      // new filters
      facingDirection,
      possessionStatus,
      postedBy,
      verificationStatus,
      dateFrom,               // ISO or yyyy-mm-dd
      dateTo,                 // ISO or yyyy-mm-dd
      propertyAgeCategory,    // New | <5 | <10 | >10

      // sorting
      sortBy = "createdAt",   // e.g. createdAt | price | bedrooms
      sortOrder = "desc",     // asc | desc

      // projection (optional)
      fields,                 // e.g. fields=title,price,city
      // alias support
      broker: brokerAlias,
    } = req.query;

    // ---- Build filter object ----
    const filter = {};

    // text search (case-insensitive)
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or = [
        { title: regex },
        { description: regex },
        { address: regex },
        { city: regex },
        // region is an ObjectId now; do not search it by regex
      ];
    }

if (city) filter.city = { $regex: `^${city}$`, $options: "i" };
// region (string) no longer filterable by name here; use regionId
if (propertyType) filter.propertyType = { $regex: `^${propertyType}$`, $options: "i" };
if (subType) filter.subType = { $regex: `^${subType}$`, $options: "i" };
if (furnishing) filter.furnishing = { $regex: `^${furnishing}$`, $options: "i" };

    if (typeof isFeatured !== "undefined") {
      filter.isFeatured = String(isFeatured).toLowerCase() === "true";
    }

    if (bedrooms !== undefined) filter.bedrooms = Number(bedrooms);
    if (bathrooms !== undefined) filter.bathrooms = Number(bathrooms);

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    // 👇 NEW: status filter (support single or comma-separated list)
    if (status) {
      const statuses = status.split(",").map(s => s.trim());
      filter.status = { $in: statuses };
    }

    // New field filters (single-value each)
    if (facingDirection) filter.facingDirection = { $regex: `^${facingDirection}$`, $options: "i" };
    if (possessionStatus) filter.possessionStatus = { $regex: `^${possessionStatus}$`, $options: "i" };
    if (postedBy) filter.postedBy = { $regex: `^${postedBy}$`, $options: "i" };
    if (verificationStatus) filter.verificationStatus = { $regex: `^${verificationStatus}$`, $options: "i" };

    // Date posted range (createdAt)
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        if (!isNaN(end.getTime())) {
          // include entire day if only a date is passed
          end.setHours(23,59,59,999);
        }
        filter.createdAt.$lte = end;
      }
    }

    // Property age category mapping (based on propertyAgeYears)
    if (propertyAgeCategory) {
      const c = String(propertyAgeCategory).trim();
      if (c === 'New') {
        filter.propertyAgeYears = { $in: [0, null] };
      } else if (c === '<5') {
        filter.propertyAgeYears = { $gte: 0, $lt: 5 };
      } else if (c === '<10') {
        filter.propertyAgeYears = { $gte: 0, $lt: 10 };
      } else if (c === '>10') {
        filter.propertyAgeYears = { $gt: 10 };
      }
    }

    // 👇 NEW: brokerId filter (supports single or comma-separated list)
    const effectiveBrokerId = brokerId || brokerAlias;
    if (effectiveBrokerId) {
      const ids = String(effectiveBrokerId)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const validIds = ids.filter(id => mongoose.isValidObjectId(id));
      if (validIds.length === 0) {
        return res.status(400).json({ success: false, message: "Invalid brokerId" });
      }
      filter.broker = validIds.length === 1
        ? validIds[0]
        : { $in: validIds };
    }

    // 👇 NEW: regionId filter (single region only)
    if (regionId) {
      if (!mongoose.isValidObjectId(regionId)) {
        return res.status(400).json({ success: false, message: "Invalid regionId" });
      }
      filter.region = regionId;
    }

    // ---- Pagination & sorting ----
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100); // cap to 100
    const skip = (pageNum - 1) * limitNum;

    // safe sort map (allow only known fields)
    const allowedSort = new Set([
      "createdAt",
      "price",
      "bedrooms",
      "bathrooms",
      "city",
      "region",
      "status"
    ]);
    const sortField = allowedSort.has(sortBy) ? sortBy : "createdAt";
    const sortDir = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortField]: sortDir };

    // projection
    const projection = fields
      ? fields.split(",").map(f => f.trim()).filter(Boolean).join(" ")
      : undefined;

    // ---- Query ----
    const [items, total] = await Promise.all([
      Property.find(filter, projection)
        .populate("broker", "name email phone firmName licenseNumber status brokerImage")
        .populate("region", "name description city state centerLocation radius")
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Property.countDocuments(filter)
    ]);

    // Get property IDs and fetch ratings
    const propertyIds = items.map(i => i._id);
    const ratingStatsAgg = propertyIds.length > 0 ? await PropertyRating.aggregate([
      { $match: { propertyId: { $in: propertyIds } } },
      {
        $group: {
          _id: '$propertyId',
          averageRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]) : [];

    // Create rating map
    const propertyIdToRating = new Map();
    for (const r of ratingStatsAgg) {
      const key = String(r._id);
      propertyIdToRating.set(key, {
        rating: Math.round(r.averageRating * 10) / 10,
        totalRatings: r.totalRatings,
        isDefaultRating: false
      });
    }

    // Attach ratings to properties (default 4 if no ratings)
    const itemsWithRatings = items.map(item => {
      const key = String(item._id);
      const ratingInfo = propertyIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
      return {
        ...item,
        rating: ratingInfo.rating,
        totalRatings: ratingInfo.totalRatings,
        isDefaultRating: ratingInfo.isDefaultRating
      };
    });

    return res.json({
      success: true,
      data: itemsWithRatings,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNextPage: skip + items.length < total,
        hasPrevPage: pageNum > 1,
      },
      sort: { sortBy: sortField, sortOrder: sortDir === 1 ? "asc" : "desc" },
      filter,
    });
  } catch (err) {
    console.error("getProperties error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error.",
      error: err.message,
    });
  }
};

export const getPropertyById = async (req, res) => {
  try {
    const { id } = req.params;
    const { fields, incView } = req.query; // e.g. ?fields=title,price,images,broker&incView=true

    // validate id
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    // optional projection: "a,b,c" -> "a b c"
    const projection = fields
      ? fields.split(",").map(s => s.trim()).filter(Boolean).join(" ")
      : undefined;

    // optional: increment views atomically before fetch
    if (String(incView).toLowerCase() === "true") {
      await Property.updateOne({ _id: id }, { $inc: { viewsCount: 1 } });
    }

const doc = await Property.findById(id, projection)
  .populate("broker", "name email phone firmName licenseNumber status brokerImage")
  .populate("region", "name description city state centerLocation radius")
  // .populate("inquiries", "name email phone message createdAt") // remove/disable
  .lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    // Calculate property rating (default 4 if no ratings)
    const ratingStats = await PropertyRating.aggregate([
      { $match: { propertyId: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]);

    // Handle case when no ratings exist (empty array or totalRatings is 0)
    const stats = ratingStats[0] || { averageRating: null, totalRatings: 0 };
    const hasRatings = stats.totalRatings > 0;
    
    const rating = hasRatings 
      ? Math.round(stats.averageRating * 10) / 10 
      : 4;

    doc.rating = rating;
    doc.totalRatings = stats.totalRatings;
    doc.isDefaultRating = !hasRatings;

    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error("getPropertyById error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};

export const approveProperty = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    const doc = await Property.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Property not found" });

    if (doc.status === "Active") {
      // already approved
      const populated = await Property.findById(id)
        .populate("broker", "name email phone firmName licenseNumber status")
        .populate("region", "name description city state centerLocation radius")
        .lean();
      return res.json({ success: true, message: "Property already active", data: populated });
    }

    doc.status = "Active";
    await doc.save();

    const populated = await Property.findById(id)
      .populate("broker", "name email phone firmName licenseNumber status brokerImage")
      .populate("region", "name description city state centerLocation radius")
      .lean();

    // Create notification for property approval (non-blocking - fire and forget)
    // Send notification to the broker who owns the property
    getUserIdFromBrokerOrProperty(populated.broker?._id || populated.broker, null)
      .then(brokerUserId => {
        if (brokerUserId) {
          return createPropertyNotification(brokerUserId, 'approved', populated, req.user);
        } else {
          console.warn('Could not find broker userId for property approval notification');
          return null;
        }
      })
      .catch(notifError => {
        console.error('Error creating approval notification:', notifError);
      });

    // Send response immediately (notification creation runs in background)
    return res.json({ success: true, message: "Property approved", data: populated });
  } catch (err) {
    console.error("approveProperty error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};

export const rejectProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    const doc = await Property.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Property not found" });

    doc.status = "Rejected";
    if (reason) {
      const stamp = new Date().toISOString();
      doc.notes = (doc.notes ? `${doc.notes}\n` : "") + `Rejected: ${reason} (${stamp})`;
    }
    await doc.save();

    const populated = await Property.findById(id)
      .populate("broker", "name email phone firmName licenseNumber status")
      .populate("region", "name description city state centerLocation radius")
      .lean();

    // Create notification for property rejection (non-blocking - fire and forget)
    // Use userId from token (req.user._id)
    if (req.user?._id) {
      createPropertyNotification(req.user._id, 'rejected', populated, req.user)
        .catch(notifError => {
          console.error('Error creating rejection notification:', notifError);
        });
    }

    // Send response immediately (notification creation runs in background)
    return res.json({ success: true, message: "Property rejected", data: populated });
  } catch (err) {
    console.error("rejectProperty error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};

// controllers/propertyController.js
export const getPropertyMetrics = async (req, res) => {
  try {
    // Total count
    const total = await Property.countDocuments();

    // Count by status
    const available = await Property.countDocuments({ status: "Active" });
    const sold = await Property.countDocuments({ status: "sold" });

    return res.json({
      success: true,
      data: { total, available, sold }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
};

// Update property
export const updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate property ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    // Check if property exists
    const existingProperty = await Property.findById(id);
    if (!existingProperty) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    // Store original status for notification check (before any updates)
    const originalStatus = existingProperty.status;

    // Authorization check: Allow update if user is admin OR if broker owns the property
    if (req.user?.role !== "admin") {
      if (req.user?.role === "broker") {
        // Check if the broker owns this property
        const broker = await BrokerDetail.findOne({ userId: req.user._id }).select('_id');
        if (!broker || String(existingProperty.broker) !== String(broker._id)) {
          return res.status(403).json({ success: false, message: "You don't have permission to update this property" });
        }
      } else {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
    }

    // Validate region if provided
    if (updateData.region) {
      if (!mongoose.isValidObjectId(updateData.region)) {
        return res.status(400).json({ success: false, message: "Valid region id is required." });
      }
      const regionExists = await Region.exists({ _id: updateData.region });
      if (!regionExists) {
        return res.status(404).json({ success: false, message: "Region not found." });
      }
    }

    // Validate broker if provided
    if (updateData.broker) {
      if (!mongoose.isValidObjectId(updateData.broker)) {
        return res.status(400).json({ success: false, message: "Valid broker id is required." });
      }
      const brokerExists = await BrokerDetail.exists({ _id: updateData.broker });
      if (!brokerExists) {
        return res.status(404).json({ success: false, message: "Broker not found." });
      }
    }

    // Handle image/video uploads if provided via files
    const rawImages = [
      ...(req.files?.images || []),
      ...(req.files?.['images[]'] || [])
    ];
    const rawVideos = [
      ...(req.files?.videos || []),
      ...(req.files?.['videos[]'] || [])
    ];

    const uploadedImages = rawImages.map(f => getFileUrl(req, f.path));
    const uploadedVideos = rawVideos.map(f => getFileUrl(req, f.path));

    // Handle images: if explicitly provided in body, use that as base (even if empty array for removal)
    // Then add any newly uploaded files to it
    if (updateData.images !== undefined) {
      // Convert to array if single value
      const bodyImages = Array.isArray(updateData.images) 
        ? updateData.images 
        : (updateData.images ? [updateData.images] : []);
      // Filter out null, undefined, empty strings, and whitespace-only strings
      const cleanBodyImages = bodyImages.filter(img => {
        if (img === null || img === undefined) return false;
        if (typeof img === 'string') {
          return img.trim() !== '';
        }
        return true; // Keep non-string values (shouldn't happen, but be safe)
      });
      // Add uploaded images to the body-provided images
      // If cleanBodyImages is empty and no uploads, this will be empty array (for deletion)
      updateData.images = cleanBodyImages.length > 0 || uploadedImages.length > 0
        ? [...cleanBodyImages, ...uploadedImages]
        : []; // Explicitly set to empty array if both are empty
    } else if (uploadedImages.length > 0) {
      // If images not provided in body but files uploaded, merge with existing
      updateData.images = [...(existingProperty.images || []), ...uploadedImages];
    }
    // If images is undefined and no uploads, don't modify existing images

    // Handle videos: if explicitly provided in body, use that as base (even if empty array for removal)
    // Then add any newly uploaded files to it
    if (updateData.videos !== undefined) {
      // Convert to array if single value
      const bodyVideos = Array.isArray(updateData.videos) 
        ? updateData.videos 
        : (updateData.videos ? [updateData.videos] : []);
      // Filter out null, undefined, empty strings, and whitespace-only strings
      const cleanBodyVideos = bodyVideos.filter(vid => {
        if (vid === null || vid === undefined) return false;
        if (typeof vid === 'string') {
          return vid.trim() !== '';
        }
        return true; // Keep non-string values (shouldn't happen, but be safe)
      });
      // Add uploaded videos to the body-provided videos
      // If cleanBodyVideos is empty and no uploads, this will be empty array (for deletion)
      updateData.videos = cleanBodyVideos.length > 0 || uploadedVideos.length > 0
        ? [...cleanBodyVideos, ...uploadedVideos]
        : []; // Explicitly set to empty array if both are empty
    } else if (uploadedVideos.length > 0) {
      // If videos not provided in body but files uploaded, merge with existing
      updateData.videos = [...(existingProperty.videos || []), ...uploadedVideos];
    }
    // If videos is undefined and no uploads, don't modify existing videos

    // Apply updates to the existing property document
    // Using save() method is more reliable for empty arrays than findByIdAndUpdate
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        existingProperty[key] = updateData[key];
      }
    });
    existingProperty.updatedAt = new Date();

    // Save the updated property
    await existingProperty.save({ runValidators: true });

    // Fetch the updated property with populated fields
    const updatedProperty = await Property.findById(id)
      .populate("broker", "name email phone firmName licenseNumber status brokerImage")
      .populate("region", "name description city state centerLocation radius")
      .lean();

    // Create notification if status changed (non-blocking - fire and forget)
    // Use userId from token (req.user._id)
    if (updateData.status && updateData.status !== originalStatus) {
      if (req.user?._id) {
        createPropertyNotification(req.user._id, 'updated', updatedProperty, req.user)
          .catch(notifError => {
            console.error('Error creating update notification:', notifError);
          });
      }
    }

    // Send response immediately (notification creation runs in background)
    return res.json({
      success: true,
      message: "Property updated successfully",
      data: updatedProperty
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Validation failed.", details: err.errors });
    }
    console.error("updateProperty error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};

// Delete property
export const deleteProperty = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate property ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    // Check if property exists
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    // Authorization check: Allow delete if user is admin OR if broker owns the property
    if (req.user?.role !== "admin") {
      if (req.user?.role === "broker") {
        // Check if the broker owns this property
        const broker = await BrokerDetail.findOne({ userId: req.user._id }).select('_id');
        if (!broker || String(property.broker) !== String(broker._id)) {
          return res.status(403).json({ success: false, message: "You don't have permission to delete this property" });
        }
      } else {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
    }

    // Delete the property first
    await Property.findByIdAndDelete(id);

    // Create notification after deleting (non-blocking - fire and forget)
    // Send notification to the broker who owns the property
    getUserIdFromBrokerOrProperty(property.broker?._id || property.broker, null)
      .then(brokerUserId => {
        if (brokerUserId) {
          return createPropertyNotification(brokerUserId, 'deleted', property, req.user);
        } else {
          console.warn('Could not find broker userId for property deletion notification');
          return null;
        }
      })
      .catch(notifError => {
        console.error('Error creating deletion notification:', notifError);
      });

    return res.json({
      success: true,
      message: "Property deleted successfully"
    });
  } catch (err) {
    console.error("deleteProperty error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};

// Get properties grouped by month for dashboard graph (12 months: Jan-Dec) - Token based
export const getPropertiesByMonth = async (req, res) => {
  try {
    const { year } = req.query || {};

    // Require authentication - broker must be logged in
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    // Build base filter
    const matchFilter = {};

    // Get broker from token - only brokers can access this endpoint
    let effectiveBrokerId = null;
    if (req.user.role === "broker") {
      try {
        const broker = await BrokerDetail.findOne({ userId: req.user._id }).select('_id');
        if (!broker) {
          return res.status(404).json({ success: false, message: "Broker profile not found" });
        }
        effectiveBrokerId = String(broker._id);
      } catch (err) {
        console.error('Error finding broker detail:', err);
        return res.status(500).json({ success: false, message: "Error finding broker profile" });
      }
    } else {
      return res.status(403).json({ success: false, message: "Only brokers can access this endpoint" });
    }

    // Apply broker filter
    if (effectiveBrokerId) {
      const brokerObjectId = new mongoose.Types.ObjectId(String(effectiveBrokerId));
      matchFilter.broker = brokerObjectId;
    }

    // Determine year - default to current year
    let targetYear;
    if (year) {
      targetYear = parseInt(year, 10);
      if (isNaN(targetYear) || targetYear < 2000 || targetYear > 2100) {
        return res.status(400).json({ success: false, message: "Invalid year format" });
      }
    } else {
      // Default to current year
      targetYear = new Date().getFullYear();
    }

    // Set date range for the entire year (Jan 1 - Dec 31)
    const startDate = new Date(targetYear, 0, 1, 0, 0, 0, 0); // January 1st
    const endDate = new Date(targetYear, 11, 31, 23, 59, 59, 999); // December 31st

    // Apply date filter to match query
    matchFilter.createdAt = {
      $gte: startDate,
      $lte: endDate
    };

    // Aggregate properties by month
    const propertiesByMonth = await Property.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          year: '$_id.year',
          month: '$_id.month',
          count: 1
        }
      }
    ]);

    // Generate all 12 months (Jan-Dec) for the target year
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const allMonths = [];
    
    for (let month = 1; month <= 12; month++) {
      const monthLabel = `${targetYear}-${month.toString().padStart(2, '0')}`;
      
      allMonths.push({
        year: targetYear,
        month: month,
        monthName: monthNames[month - 1],
        monthLabel: monthLabel,
        count: 0
      });
    }

    // Create a map of aggregated data for quick lookup
    const dataMap = new Map();
    propertiesByMonth.forEach(item => {
      const key = `${item.year}-${item.month.toString().padStart(2, '0')}`;
      dataMap.set(key, item.count);
    });

    // Merge data - fill in counts from aggregated data, keep 0 for missing months
    const result = allMonths.map(month => ({
      year: month.year,
      month: month.month,
      monthName: month.monthName,
      monthLabel: month.monthLabel,
      count: dataMap.get(month.monthLabel) || 0
    }));

    return res.json({
      success: true,
      message: "Properties by month retrieved successfully",
      data: result
    });
  } catch (err) {
    console.error("getPropertiesByMonth error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};