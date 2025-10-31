// src/controllers/propertyController.js
import mongoose from "mongoose";
import Property from "../models/Property.js";
import BrokerDetail from "../models/BrokerDetail.js"; // ✅ correct model
import Region from "../models/Region.js";
import { getFileUrl } from "../middleware/upload.js";

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
      return res.status(400).json({ message: "Valid broker id is required." });
    }

    // 2) existence check in BrokerDetail
    const exists = await BrokerDetail.exists({ _id: brokerId });
    
    if (!exists) return res.status(404).json({ message: "Broker not found." });

    // 3) Validate region as ObjectId and ensure it exists
    const regionId = region;
    if (!regionId || !mongoose.isValidObjectId(regionId)) {
      return res.status(400).json({ message: "Valid region id is required." });
    }
    const regionExists = await Region.exists({ _id: regionId });
    if (!regionExists) {
      return res.status(404).json({ message: "Region not found." });
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

    return res.status(201).json({ message: "Property created successfully.", data: created });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: "Validation failed.", details: err.errors });
    }
    return res.status(500).json({ message: "Server error.", error: err.message });
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
      Property.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
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
