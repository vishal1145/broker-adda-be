// src/controllers/propertyController.js
import mongoose from "mongoose";
import Property from "../models/Property.js";
import PropertyRating from "../models/PropertyRating.js";
import BrokerDetail from "../models/BrokerDetail.js"; // ✅ correct model
import Region from "../models/Region.js";
import { getFileUrl } from "../middleware/upload.js";
import { createPropertyNotification, createNotification, getUserIdFromBrokerOrProperty } from "../utils/notifications.js";
import User from "../models/User.js";
import { geocodeAddress } from "../utils/geocode.js";

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
      isFeatured, notes, status,
      isHotProperty,   
      createdBy        // hot property flag
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

    // 5) Geocode address to get coordinates
    let latitude = null;
    let longitude = null;
    if (address) {
      try {
        // Build full address string for geocoding
        const fullAddress = [address, city].filter(Boolean).join(', ');
        const coords = await geocodeAddress(fullAddress);
        if (coords) {
          latitude = coords.lat;
          longitude = coords.lng;
        }
      } catch (geocodeError) {
        console.error('Error geocoding address:', geocodeError);
        // Continue without coordinates if geocoding fails
      }
    }

    // 6) Create property with geocoded coordinates
    const doc = await Property.create({
      title, description, propertyDescription, propertySize,
      propertyType, subType, price, priceUnit,
      address, city, region: regionId, bedrooms, bathrooms,
      furnishing, amenities, nearbyAmenities, features, locationBenefits,
      images: finalImages,
      videos: finalVideos,
      broker: brokerId,
      isFeatured: !!isFeatured,
      isHotProperty: !!isHotProperty,
      notes,
      status, // ✅ added
      latitude,
      longitude,
      // listing meta
      facingDirection,
      possessionStatus,
      postedBy,
      verificationStatus,
      propertyAgeYears,
      createdBy
    });
    // 7) Return with populated broker and region info
    const created = await Property.findById(doc._id)
      .populate("broker", "name email phone firmName licenseNumber status")
      .populate("region", "name description city state centerLocation radius")
      .lean();

    // Send response immediately before notification creation
    res.status(201).json({ success: true, message: "Property created successfully.", data: created });

    // Create notification for property creation (non-blocking - fire and forget)
    // Send notification to the broker who owns the property
    // Don't await - let it run in background so response is sent immediately
    getUserIdFromBrokerOrProperty(brokerId, null)
      .then(brokerUserId => {
        if (brokerUserId) {
          return createPropertyNotification(brokerUserId, 'created', created, req.user);
        } else {
          console.warn('Could not find broker userId for property creation notification');
          return null;
        }
      })
      .catch(notifError => {
        console.error('Error creating property notification:', notifError);
      });

    return;
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
      isHotProperty,         // "true" | "false" - filter by hot property flag

      // sorting
      sortBy = "createdAt",   // e.g. createdAt | price | bedrooms
      sortOrder = "desc",     // asc | desc

      // projection (optional)
      fields,                 // e.g. fields=title,price,city
      // alias support
      broker: brokerAlias,
      
      // coordinate-based distance calculation (optional)
      latitude,               // User's latitude for distance calculation
      longitude,              // User's longitude for distance calculation
      radius,     
      sharedWithme = 'false',            // in kilometers, optional - if provided, filter by distance from property location
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

    // Hot property filter
    if (typeof isHotProperty !== "undefined") {
      filter.isHotProperty = String(isHotProperty).toLowerCase() === "true";
    }

    if (bedrooms !== undefined) filter.bedrooms = Number(bedrooms);
    if (bathrooms !== undefined) filter.bathrooms = Number(bathrooms);

    // Price filter (minPrice and maxPrice)
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) {
        const min = Number(minPrice);
        if (!isNaN(min) && min >= 0) {
          filter.price.$gte = min;
        }
      }
      if (maxPrice !== undefined) {
        const max = Number(maxPrice);
        if (!isNaN(max) && max >= 0) {
          filter.price.$lte = max;
        }
      }
      // Validate that minPrice <= maxPrice if both are provided
      if (minPrice !== undefined && maxPrice !== undefined) {
        const min = Number(minPrice);
        const max = Number(maxPrice);
        if (!isNaN(min) && !isNaN(max) && min > max) {
          return res.status(400).json({ 
            success: false, 
            message: "minPrice cannot be greater than maxPrice" 
          });
        }
      }
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
    // Only apply pagination if page and limit are explicitly provided
    const pageNum = (page && Number.isFinite(parseInt(page, 10)) && parseInt(page, 10) > 0) ? parseInt(page, 10) : null;
    const limitNum = (limit && Number.isFinite(parseInt(limit, 10)) && parseInt(limit, 10) > 0) ? Math.min(parseInt(limit, 10), 100) : null; // cap to 100 if provided
    const skip = (pageNum && limitNum) ? (pageNum - 1) * limitNum : 0;

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

    // Helper function to calculate distance in km using Haversine formula
    const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // Coordinate-based distance calculation
    let userLat = null;
    let userLng = null;
    let radiusKm = null;
    if (latitude && longitude) {
      userLat = parseFloat(latitude);
      userLng = parseFloat(longitude);
      
      // Validate coordinates
      if (isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid latitude or longitude values" 
        });
      }
      
      // Only use radius if explicitly provided
      if (radius) {
        radiusKm = parseFloat(radius);
        if (isNaN(radiusKm) || radiusKm <= 0) {
          return res.status(400).json({ 
            success: false, 
            message: "Invalid radius value. Must be a positive number" 
          });
        }
      }
    }

    // ---- Query ----
    // If coordinates are provided, fetch all properties first (no pagination limit)
    // Otherwise, apply pagination at database level
    let items, total;
    if (userLat !== null && userLng !== null) {
      // Fetch all properties for distance calculation
      items = await Property.find(filter, projection)
        .populate("broker", "name email phone firmName licenseNumber status brokerImage role")
        .populate("region", "name description city state centerLocation radius centerCoordinates")
        
        .lean();
      total = items.length; // Will be recalculated after distance filtering
    } else {
      // For non-geospatial queries, apply pagination at database level (only if pagination is provided)
      let itemsQuery = Property.find(filter, projection)
        .populate("broker", "name email phone firmName licenseNumber status brokerImage role")
        .populate("region", "name description city state centerLocation radius centerCoordinates")
        .sort(sort);
      
      if (pageNum && limitNum) {
        itemsQuery = itemsQuery.skip(skip).limit(limitNum);
      }
      
      const [fetchedItems, fetchedTotal] = await Promise.all([
        itemsQuery.lean(),
      Property.countDocuments(filter)
    ]);
      items = fetchedItems;
      total = fetchedTotal;
    }

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

    // Attach ratings and distance to properties, filter by radius if provided
    let propertiesWithDistance = items
      .map(item => {
      const key = String(item._id);
      const ratingInfo = propertyIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
        
        const propertyData = {
        ...item,
        rating: ratingInfo.rating,
        totalRatings: ratingInfo.totalRatings,
        isDefaultRating: ratingInfo.isDefaultRating
      };
        
        // Calculate distance from region's centerCoordinates to property's latitude/longitude
        if (userLat !== null && userLng !== null) {
          // If radius is provided, only include properties with valid coordinates
          if (radiusKm !== null) {
            // Must have valid property coordinates to filter by radius
            if (!item.latitude || !item.longitude) {
              return null; // Filter out properties without coordinates when radius is provided
            }
            
            const propertyLat = parseFloat(item.latitude);
            const propertyLng = parseFloat(item.longitude);
            
            // Validate property coordinates
            if (isNaN(propertyLat) || isNaN(propertyLng) || 
                !isFinite(propertyLat) || !isFinite(propertyLng)) {
              return null; // Filter out properties with invalid coordinates
            }
            
            // Calculate distance from user location to property location
            const distanceFromUser = calculateDistanceKm(userLat, userLng, propertyLat, propertyLng);
            propertyData.distanceKm = Number(distanceFromUser.toFixed(3));
            
            // Filter by radius
            if (distanceFromUser > radiusKm) {
              return null; // Filter out properties beyond radius
            }
            
            // Calculate distance from region center if available
            if (item.region && 
                item.region.centerCoordinates && 
                Array.isArray(item.region.centerCoordinates) && 
                item.region.centerCoordinates.length === 2) {
              const [regionLat, regionLng] = item.region.centerCoordinates;
              if (!isNaN(regionLat) && !isNaN(regionLng) && 
                  isFinite(regionLat) && isFinite(regionLng)) {
                const distanceFromRegion = calculateDistanceKm(regionLat, regionLng, propertyLat, propertyLng);
                propertyData.distanceFromRegionKm = Number(distanceFromRegion.toFixed(3));
              }
            }
            
            return propertyData;
          } else {
            // No radius provided - calculate distance but include all properties
            if (item.latitude && item.longitude) {
              const propertyLat = parseFloat(item.latitude);
              const propertyLng = parseFloat(item.longitude);
              
              // Validate property coordinates
              if (!isNaN(propertyLat) && !isNaN(propertyLng) &&
                  isFinite(propertyLat) && isFinite(propertyLng)) {
                // Calculate distance from user location to property location
                const distanceFromUser = calculateDistanceKm(userLat, userLng, propertyLat, propertyLng);
                propertyData.distanceKm = Number(distanceFromUser.toFixed(3));
                
                // Calculate distance from region center if available
                if (item.region && 
                    item.region.centerCoordinates && 
                    Array.isArray(item.region.centerCoordinates) && 
                    item.region.centerCoordinates.length === 2) {
                  const [regionLat, regionLng] = item.region.centerCoordinates;
                  if (!isNaN(regionLat) && !isNaN(regionLng) && 
                      isFinite(regionLat) && isFinite(regionLng)) {
                    const distanceFromRegion = calculateDistanceKm(regionLat, regionLng, propertyLat, propertyLng);
                    propertyData.distanceFromRegionKm = Number(distanceFromRegion.toFixed(3));
                  }
                }
              }
            }
            return propertyData;
          }
        }
        
        // If coordinates not provided, return property without distance
        return propertyData;
      })
      .filter(property => property !== null); // Remove null entries
    
    // Calculate total count for pagination (before pagination is applied)
    let totalCount = total;
    if (userLat !== null && userLng !== null) {
      // Total count is the length of filtered properties (before pagination)
      totalCount = propertiesWithDistance.length;
    }
    
    // Sort by distance if coordinates are provided (unless another sort is explicitly specified)
    if (userLat !== null && userLng !== null && (!sortBy || sortBy === "createdAt")) {
      propertiesWithDistance.sort((a, b) => {
        const distA = a.distanceKm || Infinity;
        const distB = b.distanceKm || Infinity;
        return distA - distB; // Ascending order (closest first)
      });
    }
    
    // Apply pagination after distance filtering (only if pagination parameters are provided)
    if (userLat !== null && userLng !== null && pageNum && limitNum) {
      const startIndex = skip;
      const endIndex = skip + limitNum;
      propertiesWithDistance = propertiesWithDistance.slice(startIndex, endIndex);
    }
    
    let allProperties;

    
    if (sharedWithme === "true" || sharedWithme === true) {

      console.log("yha aaya hai if");
      
      const sharedProperties = await Property.find({ transfers: { $in: [new mongoose.Types.ObjectId(brokerAlias)] } }).lean();
      allProperties = sharedProperties;
    }else {
      console.log("yha aaya hai else");

      allProperties = propertiesWithDistance;

    }

    return res.json({
      success: true,
        data: allProperties,
      pagination: {
        total: allProperties.length,
        page: pageNum || 1,
        limit: limitNum || allProperties.length,
        totalPages: limitNum ? Math.ceil(allProperties.length / limitNum) : 1,
        hasNextPage: (pageNum && limitNum) ? (skip + allProperties.length < allProperties.length) : false,
        hasPrevPage: (pageNum && limitNum) ? pageNum > 1 : false,
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

    // Geocode address if address or city is being updated
    if (updateData.address !== undefined || updateData.city !== undefined) {
      const addressToGeocode = updateData.address !== undefined 
        ? updateData.address 
        : existingProperty.address;
      const cityToGeocode = updateData.city !== undefined 
        ? updateData.city 
        : existingProperty.city;
      
      if (addressToGeocode) {
        try {
          // Build full address string for geocoding
          const fullAddress = [addressToGeocode, cityToGeocode].filter(Boolean).join(', ');
          const coords = await geocodeAddress(fullAddress);
          if (coords) {
            updateData.latitude = coords.lat;
            updateData.longitude = coords.lng;
          } else {
            // If geocoding fails, set to null to clear old coordinates
            updateData.latitude = null;
            updateData.longitude = null;
          }
        } catch (geocodeError) {
          console.error('Error geocoding address during update:', geocodeError);
          // Continue without updating coordinates if geocoding fails
        }
      }
    }

    // Apply updates to the existing property document
    // Using save() method is more reliable for empty arrays than findByIdAndUpdate
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        existingProperty[key] = updateData[key];
        // Explicitly mark array fields as modified when set to empty arrays
        // This ensures Mongoose properly tracks and persists empty array changes
        if ((key === 'images' || key === 'videos') && Array.isArray(updateData[key]) && updateData[key].length === 0) {
          existingProperty.markModified(key);
        }
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

export const transferProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const { ids, transferType } = req.body;
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }
    if (transferType === 'all') {
      const brokers = await BrokerDetail.find({});
      brokers.forEach(broker => {
        property.transfers.push( broker._id);
      });
    } else if (transferType === 'selected') {
      if (!ids.length) {
        return res.status(400).json({ success: false, message: "At least one toBroker is required" });
      }
      ids.forEach(id => {
        property.transfers.push(id);
      });
    } else if (transferType === 'region') {
      if (!ids.length) {
        return res.status(400).json({ success: false, message: "region is required" });
      }
      const brokers = await BrokerDetail.find({region: { $in: ids } });
      brokers.forEach(broker => {
        property.transfers.push(broker._id);
      });
    }
    await property.save();
    return res.json({ success: true, message: "Property transferred successfully" });
  } catch (err) {
    console.error("transferProperty error:", err);
    return res.status(500).json({ success: false, message: "Server error.", error: err.message });
  }
};