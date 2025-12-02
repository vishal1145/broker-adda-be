import BrokerDetail from '../models/BrokerDetail.js';
import BrokerRating from '../models/BrokerRating.js';
import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';
import { updateRegionBrokerCount, updateMultipleRegionBrokerCounts } from '../utils/brokerCount.js';
import { createNotification } from '../utils/notifications.js';
import Subscription from '../models/Subscription.js';
import mongoose from 'mongoose';

// Get all brokers (with pagination and filtering) - All roles allowed
export const getAllBrokers = async (req, res) => {
  try {
    // Extract query parameters, treating empty strings as undefined
    const cleanQuery = {};
    Object.keys(req.query || {}).forEach(key => {
      const value = req.query[key];
      // Only include non-empty values (empty strings are treated as not provided)
      if (value !== undefined && value !== null && value !== '') {
        cleanQuery[key] = value;
      }
    });
    
    const { 
      page, 
      limit, 
      status, 
      approvedByAdmin, 
      regionId,
      city,
      regionCity,
      search,
      minExperience,
      maxExperience,
      verificationStatus,
      minRating,
      maxRating,
      rating,
      specialization,
      sortBy,
      sortOrder,
      latitude,
      longitude,
      radius // in kilometers, default 50km if not provided
    } = cleanQuery;

    // Build filter object
    // Include brokers with role='broker' OR role not set (legacy brokers)
    // This ensures we get all brokers even if some don't have the role field set
    const filter = {
      $or: [
        { role: 'broker' },
        { role: { $exists: false } },
        { role: null }
      ]
    };
    
    // Only add status filter if explicitly provided (not empty string)
    if (status && status !== '') {
      filter.status = status;
    }
    
    // Only add approvedByAdmin filter if explicitly provided (not empty string or null)
    if (approvedByAdmin !== undefined && approvedByAdmin !== null && approvedByAdmin !== '') {
      filter.approvedByAdmin = approvedByAdmin;
    }
    
    if (regionId) {
      filter.region = regionId;
    }

    if (city) {
      filter.city = { $regex: `^${city}$`, $options: 'i' };
    }

    // Filter by Region.city via regionCity param
    if (regionCity) {
      const Region = (await import('../models/Region.js')).default;
      const regions = await Region.find({ city: { $regex: `^${regionCity}$`, $options: 'i' } }).select('_id');
      const regionIds = regions.map(r => r._id);
      if (regionIds.length > 0) {
        filter.region = { $in: regionIds };
      } else {
        // Force empty result if no matching regions
        filter.region = { $in: [] };
      }
    }

    // Experience range filter (experience.years)
    if (minExperience !== undefined || maxExperience !== undefined) {
      const yearsFilter = {};
      if (minExperience !== undefined) yearsFilter.$gte = Number(minExperience);
      if (maxExperience !== undefined) yearsFilter.$lte = Number(maxExperience);
      filter['experience.years'] = yearsFilter;
    }

    // Verification status filter
    if (verificationStatus) {
      filter.verificationStatus = verificationStatus;
    }

    // Rating filters
    if (rating !== undefined) {
      filter.rating = Number(rating);
    } else if (minRating !== undefined || maxRating !== undefined) {
      filter.rating = {};
      if (minRating !== undefined) filter.rating.$gte = Number(minRating);
      if (maxRating !== undefined) filter.rating.$lte = Number(maxRating);
    }

    // Specialization filter (matches if broker has this specialization in their array)
    if (specialization) {
      filter.specializations = { $in: [specialization] };
    }

    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { whatsappNumber: { $regex: search, $options: 'i' } },
        { firmName: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { website: { $regex: search, $options: 'i' } }
      ];
    }

    // Geospatial filtering by latitude/longitude
    let geospatialQuery = null;
    let userLat = null;
    let userLng = null;
    let radiusKm = null;
    if (latitude && longitude) {
      userLat = parseFloat(latitude);
      userLng = parseFloat(longitude);
      
      // Only use radius if explicitly provided
      if (radius) {
        radiusKm = parseFloat(radius);
        if (isNaN(radiusKm) || radiusKm <= 0) {
          return errorResponse(res, 'Invalid radius value. Must be a positive number', 400);
        }
      }

      // Validate coordinates
      if (isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
        return errorResponse(res, 'Invalid latitude or longitude values', 400);
      }

      if (radiusKm !== null) {
      // Use $geoWithin with $centerSphere instead of $near to avoid sorting conflicts
      // $centerSphere requires radius in radians: radiusInRadians = radiusInKm / 6378.1
      // NOTE: The data is stored as [latitude, longitude] instead of GeoJSON standard [longitude, latitude]
      // This is due to how coordinates are saved in authController.js (line 882)
      // So we use [userLat, userLng] to match the stored format
      const radiusInRadians = radiusKm / 6378.1; // Earth's radius in km
      geospatialQuery = {
        location: {
          $geoWithin: {
            $centerSphere: [
              [userLat, userLng], // [latitude, longitude] - matching stored format
              radiusInRadians
            ]
          }
        }
      };
      }
    }

    // Calculate pagination (only if page/limit are explicitly provided)
    // If neither is provided, return ALL brokers without pagination
    const pageNum = (page !== undefined && page !== null && page !== '') ? parseInt(page) : null;
    const limitNum = (limit !== undefined && limit !== null && limit !== '') ? parseInt(limit) : null;
    const skip = (pageNum && limitNum) ? (pageNum - 1) * limitNum : 0;

    // Build sort object
    let sort = { createdAt: -1 }; // Default sort
    if (sortBy) {
      const allowedSortFields = ['rating', 'createdAt', 'name', 'firmName', 'experience.years'];
      if (allowedSortFields.includes(sortBy)) {
        const order = sortOrder === 'asc' ? 1 : -1;
        sort = { [sortBy]: order };
      }
    } else if (sortOrder) {
      // If only sortOrder provided without sortBy, apply to default createdAt
      const order = sortOrder === 'asc' ? 1 : -1;
      sort = { createdAt: order };
    }

    // Combine regular filter - don't filter by location when coordinates are provided
    // We'll fetch all brokers and calculate distance for those with coordinates
    // Brokers without coordinates will be included at the end (if no radius filter)
    let finalFilter = filter;
    
    // Debug: Log the filter being applied (remove in production)
    console.log('Broker filter being applied:', JSON.stringify(finalFilter, null, 2));
    console.log('Pagination params - pageNum:', pageNum, 'limitNum:', limitNum);
    
    // Debug: Check total brokers in database vs filtered
    const totalAllBrokersInDB = await BrokerDetail.countDocuments({});
    const totalFilteredBrokers = await BrokerDetail.countDocuments(finalFilter);
    console.log(`Total brokers in DB: ${totalAllBrokersInDB}, Filtered brokers: ${totalFilteredBrokers}`);

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

    // Get brokers with populated region data
    // If coordinates are provided, fetch all brokers with location and calculate distance
    // Otherwise, apply pagination at database level
    let brokers;
    if (userLat !== null && userLng !== null) {
      // For coordinate-based queries, fetch all brokers with location (no pagination limit initially)
      brokers = await BrokerDetail.find(finalFilter)
        .populate('region', 'name description city state centerLocation radius')
        .sort({}); // Don't sort at DB level, we'll sort by distance
    } else {
      // For non-geospatial queries, apply pagination at database level (only if pagination is provided)
      let brokersQuery = BrokerDetail.find(finalFilter)
        .populate('region', 'name description city state centerLocation radius')
        .sort(sort);
      
      if (pageNum && limitNum) {
        brokersQuery = brokersQuery.skip(skip).limit(limitNum);
      }
      
      brokers = await brokersQuery;
      
      // Debug: Log how many brokers were fetched
      console.log(`Fetched ${brokers.length} brokers from database (no geospatial filter)`);
    }

    // If coordinates are provided, calculate distance for all brokers and filter by radius if provided
    // This is necessary because coordinates are stored as [lat, lng] instead of [lng, lat]
    if (userLat !== null && userLng !== null) {
      // Calculate distance for all brokers and add distance field
      // Preserve populated fields (like region) when converting to objects
      const brokersWithDistance = [];
      const brokersWithoutCoordinates = [];
      
      for (const broker of brokers) {
        // Convert to object while preserving populated fields
        const brokerObj = broker.toObject ? broker.toObject({ virtuals: true }) : broker;
        
        // Ensure _id is preserved as string for easier handling
        if (brokerObj._id && typeof brokerObj._id.toString === 'function') {
          brokerObj._id = brokerObj._id.toString();
        }
        
        if (brokerObj.location && brokerObj.location.coordinates && Array.isArray(brokerObj.location.coordinates) && brokerObj.location.coordinates.length === 2) {
          // NOTE: Coordinates are stored as [latitude, longitude] not [longitude, latitude]
          const [brokerLat, brokerLng] = brokerObj.location.coordinates; // [lat, lng]
          
          // Validate coordinates
          if (isNaN(brokerLat) || isNaN(brokerLng) || !isFinite(brokerLat) || !isFinite(brokerLng)) {
            // Invalid coordinates - include without distance if no radius filter
            if (radiusKm === null) {
              brokersWithoutCoordinates.push(brokerObj);
            }
            continue;
          }
          
          const distance = calculateDistanceKm(userLat, userLng, brokerLat, brokerLng);
          
          // Only filter by radius if radius is explicitly provided
          // If no radius, include all brokers with valid coordinates
          if (radiusKm === null || distance <= radiusKm) {
            // Add distance property to the broker object
            brokerObj.distanceKm = Number(distance.toFixed(3));
            brokersWithDistance.push(brokerObj);
          }
        } else {
          // No coordinates - include without distance if no radius filter
          // (If radius is provided, we can't calculate distance, so exclude them)
          if (radiusKm === null) {
            brokersWithoutCoordinates.push(brokerObj);
          }
        }
      }
      
      // Combine brokers: those with distance first (sorted), then those without coordinates
      brokers = brokersWithDistance;

      // Always sort by distance in ascending order when coordinates are provided
      // (unless another sort is explicitly specified)
      if (!sortBy || sortBy === 'createdAt') {
        brokers.sort((a, b) => {
          const distA = a.distanceKm || Infinity;
          const distB = b.distanceKm || Infinity;
          return distA - distB; // Ascending order (closest first)
        });
      }
      
      // Append brokers without coordinates at the end (they don't have distance)
      brokers = [...brokers, ...brokersWithoutCoordinates];

      // Apply pagination after distance filtering (only if pagination parameters are provided)
      if (pageNum && limitNum) {
        brokers = brokers.slice(skip, skip + limitNum);
      }
    }

    // Get total count for pagination
    // If we filtered manually by distance, we need to count manually too
    let totalBrokers;
    if (userLat !== null && userLng !== null) {
      if (radiusKm !== null) {
        // If radius is provided, only count brokers with valid coordinates within radius
        const allBrokersWithLocation = await BrokerDetail.find({
          ...filter,
          'location.coordinates': { $exists: true, $ne: null, $size: 2 }
        }).select('location').lean();
        
        totalBrokers = allBrokersWithLocation.filter(broker => {
          if (broker.location && broker.location.coordinates && broker.location.coordinates.length === 2) {
            const [brokerLat, brokerLng] = broker.location.coordinates;
            if (isNaN(brokerLat) || isNaN(brokerLng) || !isFinite(brokerLat) || !isFinite(brokerLng)) {
              return false; // Skip invalid coordinates
            }
            
            const distance = calculateDistanceKm(userLat, userLng, brokerLat, brokerLng);
            return distance <= radiusKm;
          }
          return false;
        }).length;
      } else {
        // If no radius, count all brokers (with or without coordinates)
        // This matches the behavior of including all brokers
        totalBrokers = await BrokerDetail.countDocuments(finalFilter);
      }
    } else {
      totalBrokers = await BrokerDetail.countDocuments(finalFilter);
      // Debug: Log the total count
      console.log(`Total brokers count from database: ${totalBrokers}`);
    }
    const totalPages = limitNum ? Math.ceil(totalBrokers / limitNum) : 1;

    // Get blocked and unblocked counts (without filters for overall stats)
    const totalBlockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'blocked' });
    const totalUnblockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'unblocked' });

    // Prepare lead/property stats and property lists for each broker
    const brokerIds = brokers.map(b => {
      // Handle both Mongoose documents and plain objects
      if (b && b._id) {
        // Convert to ObjectId if it's a string, otherwise use as is
        if (typeof b._id === 'string') {
          return mongoose.Types.ObjectId.isValid(b._id) ? new mongoose.Types.ObjectId(b._id) : null;
        }
        return b._id;
      }
      if (b && b.toObject && typeof b.toObject === 'function') {
        const obj = b.toObject();
        if (obj && obj._id) {
          if (typeof obj._id === 'string') {
            return mongoose.Types.ObjectId.isValid(obj._id) ? new mongoose.Types.ObjectId(obj._id) : null;
          }
          return obj._id;
        }
      }
      return null;
    }).filter(id => id !== null); // Remove null entries
    
    // Only fetch lead/property stats if we have brokers
    const [leadCountsAgg, leadsBasic, propertyCountsAgg, brokerProperties, ratingStatsAgg] = await Promise.all([
      brokerIds.length > 0 ? Lead.aggregate([
        { $match: { createdBy: { $in: brokerIds } } },
        { $group: { _id: '$createdBy', count: { $sum: 1 } } }
      ]) : Promise.resolve([]),
      brokerIds.length > 0 ? Lead.find({ createdBy: { $in: brokerIds } })
        .select('customerName customerEmail customerPhone requirement propertyType budget status primaryRegion secondaryRegion createdAt updatedAt createdBy')
        .lean() : Promise.resolve([]),
      brokerIds.length > 0 ? Property.aggregate([
        { $match: { broker: { $in: brokerIds } } },
        { $group: { _id: '$broker', count: { $sum: 1 } } }
      ]) : Promise.resolve([]),
      brokerIds.length > 0 ? Property.find({ broker: { $in: brokerIds } })
        .select('_id title price priceUnit images status createdAt broker')
        .sort({ createdAt: -1 })
        .lean() : Promise.resolve([]),
      brokerIds.length > 0 ? BrokerRating.aggregate([
        { $match: { brokerId: { $in: brokerIds } } },
        {
          $group: {
            _id: '$brokerId',
            averageRating: { $avg: '$rating' },
            totalRatings: { $sum: 1 }
          }
        }
      ]) : Promise.resolve([])
    ]);
    const brokerIdToLeadCount = new Map(leadCountsAgg.map(x => [String(x._id), x.count]));
    const brokerIdToPropertyCount = new Map(propertyCountsAgg.map(x => [String(x._id), x.count]));
    const brokerIdToRating = new Map();
    for (const r of ratingStatsAgg) {
      const key = String(r._id);
      brokerIdToRating.set(key, {
        rating: Math.round(r.averageRating * 10) / 10,
        totalRatings: r.totalRatings,
        isDefaultRating: false
      });
    }
    const brokerIdToLeads = new Map();
    const brokerIdToProperties = new Map();
    for (const l of leadsBasic) {
      // Ensure consistent string conversion for Map keys
      const key = l.createdBy ? String(l.createdBy) : null;
      if (!key) continue; // Skip if no createdBy
      if (!brokerIdToLeads.has(key)) brokerIdToLeads.set(key, []);
      brokerIdToLeads.get(key).push({
        _id: l._id,
        customerName: l.customerName,
        customerEmail: l.customerEmail,
        customerPhone: l.customerPhone,
        requirement: l.requirement,
        propertyType: l.propertyType,
        budget: l.budget,
        status: l.status,
        primaryRegion: l.primaryRegion,
        secondaryRegion: l.secondaryRegion,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt
      });
    }

    // Group properties by broker
    for (const p of brokerProperties) {
      // Ensure consistent string conversion for Map keys
      const key = p.broker ? String(p.broker) : null;
      if (!key) continue; // Skip if no broker
      if (!brokerIdToProperties.has(key)) brokerIdToProperties.set(key, []);
      brokerIdToProperties.get(key).push({
        _id: p._id,
        title: p.title,
        price: p.price,
        priceUnit: p.priceUnit,
        images: p.images,
        status: p.status,
        createdAt: p.createdAt
      });
    }

    // Convert file paths to URLs and attach lead stats
    const brokersWithUrlsPromises = brokers.map(async broker => {
      // If broker is already an object (from geospatial processing), use it directly
      const brokerObj = broker.toObject ? broker.toObject() : broker;
     
      // Convert kycDocs file paths to URLs
      if (brokerObj.kycDocs) {
        if (brokerObj.kycDocs.aadhar) {
          brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
        }
        if (brokerObj.kycDocs.aadharFront) {
          brokerObj.kycDocs.aadharFront = getFileUrl(req, brokerObj.kycDocs.aadharFront);
        }
        if (brokerObj.kycDocs.aadharBack) {
          brokerObj.kycDocs.aadharBack = getFileUrl(req, brokerObj.kycDocs.aadharBack);
        }
        if (brokerObj.kycDocs.pan) {
          brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
        }
        if (brokerObj.kycDocs.panFront) {
          brokerObj.kycDocs.panFront = getFileUrl(req, brokerObj.kycDocs.panFront);
        }
        if (brokerObj.kycDocs.panBack) {
          brokerObj.kycDocs.panBack = getFileUrl(req, brokerObj.kycDocs.panBack);
        }
        if (brokerObj.kycDocs.gst) {
          brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
        }
        if (brokerObj.kycDocs.brokerLicense) {
          brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
        }
        if (brokerObj.kycDocs.companyId) {
          brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
        }
      }
      
      // Convert broker image path to URL
      if (brokerObj.brokerImage) {
        brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
      }

      // Attach lead and property stats
      const key = String(brokerObj._id);
      const leads = brokerIdToLeads.get(key) || [];
      const properties = brokerIdToProperties.get(key) || [];
      
      // Use actual count from items array to ensure accuracy
      // Fallback to aggregation count if items array is empty but count exists
      const leadCountFromItems = leads.length;
      const leadCountFromAgg = brokerIdToLeadCount.get(key) || 0;
      const propertyCountFromItems = properties.length;
      const propertyCountFromAgg = brokerIdToPropertyCount.get(key) || 0;
      
      brokerObj.leadsCreated = {
        count: leadCountFromItems > 0 ? leadCountFromItems : leadCountFromAgg,
        items: leads
      };
      brokerObj.leadCount = leadCountFromItems > 0 ? leadCountFromItems : leadCountFromAgg;
      brokerObj.propertyCount = propertyCountFromItems > 0 ? propertyCountFromItems : propertyCountFromAgg;
      brokerObj.properties = properties;

      // Attach rating (default 4 if no ratings)
      const ratingInfo = brokerIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
      brokerObj.rating = ratingInfo.rating;
      brokerObj.totalRatings = ratingInfo.totalRatings;
      brokerObj.isDefaultRating = ratingInfo.isDefaultRating;

      const brokerSubscription = await Subscription.findOne({ user: new mongoose.Types.ObjectId(brokerObj.userId), endDate: { $gt: new Date() } });
      brokerObj.subscription = brokerSubscription || null;

      return brokerObj;
    });

    const brokersWithUrls = await Promise.all(brokersWithUrlsPromises);

    // Use the already parsed page number (or 1 if no pagination provided)
    // If no pagination is provided, show all brokers and set pagination info accordingly
    const currentPage = pageNum || 1;
    const isPaginationApplied = pageNum !== null && limitNum !== null;
    
    return successResponse(res, 'Brokers retrieved successfully', {
      brokers: brokersWithUrls,
      pagination: {
        currentPage: isPaginationApplied ? currentPage : 1,
        totalPages: isPaginationApplied ? totalPages : 1,
        totalBrokers,
        hasNextPage: isPaginationApplied ? currentPage < totalPages : false,
        hasPrevPage: isPaginationApplied ? currentPage > 1 : false
      },
      stats: {
        totalBlockedBrokers,
        totalUnblockedBrokers,
        totalAllBrokers: totalBlockedBrokers + totalUnblockedBrokers
      }
    });

  } catch (error) {
    console.error('Error in getAllBrokers:', error);
    return serverError(res, error);
  }
};

// Get single broker details by userId
export const getBrokerById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker by userId instead of _id
    const broker = await BrokerDetail.findOne({ userId: id })
      .populate('region', 'name description city state centerLocation radius')
      .populate('userId', 'name email phone status emailNotification smsNotification pushNotification');

    const brokerSubscription = await Subscription.findOne({ user: new mongoose.Types.ObjectId(id), endDate: { $gt: new Date() } });

    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Convert file paths to URLs
    const brokerObj = broker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.aadharFront) {
        brokerObj.kycDocs.aadharFront = getFileUrl(req, brokerObj.kycDocs.aadharFront);
      }
      if (brokerObj.kycDocs.aadharBack) {
        brokerObj.kycDocs.aadharBack = getFileUrl(req, brokerObj.kycDocs.aadharBack);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.panFront) {
        brokerObj.kycDocs.panFront = getFileUrl(req, brokerObj.kycDocs.panFront);
      }
      if (brokerObj.kycDocs.panBack) {
        brokerObj.kycDocs.panBack = getFileUrl(req, brokerObj.kycDocs.panBack);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    // Lead and property stats for this broker
    const [leadCount, leads, propertyCount, properties] = await Promise.all([
      Lead.countDocuments({ createdBy: broker._id }),
      Lead.find({ createdBy: broker._id })
        .select('customerName customerEmail customerPhone requirement propertyType budget status primaryRegion secondaryRegion createdAt updatedAt')
        .lean(),
      Property.countDocuments({ broker: broker._id }),
      Property.find({ broker: broker._id })
        .select('_id title price priceUnit images status createdAt')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    // Calculate broker rating (default 4 if no ratings)
    const ratingStats = await BrokerRating.aggregate([
      { $match: { brokerId: broker._id } },
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

    brokerObj.rating = rating;
    brokerObj.totalRatings = stats.totalRatings;
    brokerObj.isDefaultRating = !hasRatings;

    brokerObj.leadsCreated = {
      count: leadCount,
      items: leads
    };
    brokerObj.leadCount = leadCount;
    brokerObj.propertyCount = propertyCount;
    brokerObj.properties = properties;
    brokerObj.propertiesListed = {
      count: propertyCount,
      items: properties
    };
    brokerObj.subscription = brokerSubscription ? brokerSubscription.toObject() : null;

    return successResponse(res, 'Broker details retrieved successfully', { broker: brokerObj });

  } catch (error) {
    return serverError(res, error);
  }
};

// Approve broker
export const approveBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker approval status
    broker.approvedByAdmin = 'unblocked';
    await broker.save();

    // Update user status to active if it was pending
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { status: 'active' });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Create notifications for broker approval (non-blocking - fire and forget)
    // Send to broker AND admin
    if (broker.userId) {
      // Notification to broker
      createNotification({
        userId: broker.userId,
        type: 'approval',
        title: 'Broker Account Approved',
        message: 'Your broker account has been approved and unblocked by admin.',
        priority: 'high',
        relatedEntity: {
          entityType: 'BrokerDetail',
          entityId: broker._id
        },
        activity: {
          action: 'approved',
          actorId: req.user?._id || null,
          actorName: req.user?.name || 'Admin'
        },
        metadata: {
          brokerId: broker._id,
          status: 'unblocked'
        }
      }).catch(notifError => {
        console.error('Error creating broker approval notification to broker:', notifError);
      });
    }

    // Notify all admin users
    User.find({ role: 'admin' })
      .select('_id name email')
      .then(admins => {
        admins.forEach(admin => {
          const isActor = req.user?._id && admin._id.toString() === req.user._id.toString();
          createNotification({
            userId: admin._id,
            type: 'approval',
            title: 'Broker Account Approved',
            message: `Broker account for ${broker.name || broker.email || 'broker'} has been approved${isActor ? ' by you' : req.user?.name ? ` by ${req.user.name}` : ' by admin'}.`,
            priority: isActor ? 'medium' : 'low',
            relatedEntity: {
              entityType: 'BrokerDetail',
              entityId: broker._id
            },
            activity: {
              action: 'approved',
              actorId: req.user?._id || null,
              actorName: req.user?.name || 'Admin'
            },
            metadata: {
              brokerId: broker._id,
              status: 'unblocked'
            }
          }).catch(notifError => {
            console.error(`Error creating broker approval notification to admin ${admin._id}:`, notifError);
          });
        });
      })
      .catch(error => {
        console.error('Error fetching admin users for broker approval notification:', error);
      });

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.aadharFront) {
        brokerObj.kycDocs.aadharFront = getFileUrl(req, brokerObj.kycDocs.aadharFront);
      }
      if (brokerObj.kycDocs.aadharBack) {
        brokerObj.kycDocs.aadharBack = getFileUrl(req, brokerObj.kycDocs.aadharBack);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.panFront) {
        brokerObj.kycDocs.panFront = getFileUrl(req, brokerObj.kycDocs.panFront);
      }
      if (brokerObj.kycDocs.panBack) {
        brokerObj.kycDocs.panBack = getFileUrl(req, brokerObj.kycDocs.panBack);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker unblocked successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Reject broker
export const rejectBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker rejection status
    broker.approvedByAdmin = 'blocked';
    await broker.save();

    // Update user status to suspended if needed
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { 
        status: 'inactive' 
      });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Create notifications for broker rejection/blocking (non-blocking - fire and forget)
    // Send to broker AND admin
    if (broker.userId) {
      // Notification to broker
      createNotification({
        userId: broker.userId,
        type: 'approval',
        title: 'Broker Account Blocked',
        message: 'Your broker account has been blocked by admin. Please contact support for more information.',
        priority: 'high',
        relatedEntity: {
          entityType: 'BrokerDetail',
          entityId: broker._id
        },
        activity: {
          action: 'blocked',
          actorId: req.user?._id || null,
          actorName: req.user?.name || 'Admin'
        },
        metadata: {
          brokerId: broker._id,
          status: 'blocked'
        }
      }).catch(notifError => {
        console.error('Error creating broker rejection notification to broker:', notifError);
      });
    }

    // Notify all admin users
    User.find({ role: 'admin' })
      .select('_id name email')
      .then(admins => {
        admins.forEach(admin => {
          const isActor = req.user?._id && admin._id.toString() === req.user._id.toString();
          createNotification({
            userId: admin._id,
            type: 'approval',
            title: 'Broker Account Blocked',
            message: `Broker account for ${broker.name || broker.email || 'broker'} has been blocked${isActor ? ' by you' : req.user?.name ? ` by ${req.user.name}` : ' by admin'}.`,
            priority: isActor ? 'medium' : 'low',
            relatedEntity: {
              entityType: 'BrokerDetail',
              entityId: broker._id
            },
            activity: {
              action: 'blocked',
              actorId: req.user?._id || null,
              actorName: req.user?.name || 'Admin'
            },
            metadata: {
              brokerId: broker._id,
              status: 'blocked'
            }
          }).catch(notifError => {
            console.error(`Error creating broker rejection notification to admin ${admin._id}:`, notifError);
          });
        });
      })
      .catch(error => {
        console.error('Error fetching admin users for broker rejection notification:', error);
      });

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.aadharFront) {
        brokerObj.kycDocs.aadharFront = getFileUrl(req, brokerObj.kycDocs.aadharFront);
      }
      if (brokerObj.kycDocs.aadharBack) {
        brokerObj.kycDocs.aadharBack = getFileUrl(req, brokerObj.kycDocs.aadharBack);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.panFront) {
        brokerObj.kycDocs.panFront = getFileUrl(req, brokerObj.kycDocs.panFront);
      }
      if (brokerObj.kycDocs.panBack) {
        brokerObj.kycDocs.panBack = getFileUrl(req, brokerObj.kycDocs.panBack);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker blocked successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Update broker verification status (Admin only)
export const updateBrokerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus } = req.body;

    // Check admin access
    if (!req.user || req.user.role !== 'admin') {
      return errorResponse(res, 'Admin access required', 403);
    }

    // Validate verificationStatus
    if (!verificationStatus || !['Verified', 'Unverified'].includes(verificationStatus)) {
      return errorResponse(res, 'Invalid verificationStatus. Must be "Verified" or "Unverified"', 400);
    }

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update verification status
    broker.verificationStatus = verificationStatus;
    await broker.save();

    // Create notifications for verification status change (non-blocking - fire and forget)
    // Send to broker AND admin
    if (broker.userId) {
      // Notification to broker
      createNotification({
        userId: broker.userId,
        type: 'approval',
        title: `Broker Verification Status: ${verificationStatus}`,
        message: `Your broker verification status has been updated to ${verificationStatus} by admin.`,
        priority: verificationStatus === 'Verified' ? 'high' : 'medium',
        relatedEntity: {
          entityType: 'BrokerDetail',
          entityId: broker._id
        },
        activity: {
          action: 'verificationUpdated',
          actorId: req.user?._id || null,
          actorName: req.user?.name || 'Admin'
        },
        metadata: {
          brokerId: broker._id,
          verificationStatus
        }
      }).catch(notifError => {
        console.error('Error creating verification notification to broker:', notifError);
      });
    }

    // Notify all admin users
    User.find({ role: 'admin' })
      .select('_id name email')
      .then(admins => {
        admins.forEach(admin => {
          const isActor = req.user?._id && admin._id.toString() === req.user._id.toString();
          createNotification({
            userId: admin._id,
            type: 'approval',
            title: `Broker Verification Status Updated: ${verificationStatus}`,
            message: `Broker verification status for ${broker.name || broker.email || 'broker'} has been updated to ${verificationStatus}${isActor ? ' by you' : req.user?.name ? ` by ${req.user.name}` : ' by admin'}.`,
            priority: verificationStatus === 'Verified' ? (isActor ? 'medium' : 'low') : 'low',
            relatedEntity: {
              entityType: 'BrokerDetail',
              entityId: broker._id
            },
            activity: {
              action: 'verificationUpdated',
              actorId: req.user?._id || null,
              actorName: req.user?.name || 'Admin'
            },
            metadata: {
              brokerId: broker._id,
              verificationStatus
            }
          }).catch(notifError => {
            console.error(`Error creating verification notification to admin ${admin._id}:`, notifError);
          });
        });
      })
      .catch(error => {
        console.error('Error fetching admin users for broker verification notification:', error);
      });

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description city state centerLocation radius');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.aadharFront) {
        brokerObj.kycDocs.aadharFront = getFileUrl(req, brokerObj.kycDocs.aadharFront);
      }
      if (brokerObj.kycDocs.aadharBack) {
        brokerObj.kycDocs.aadharBack = getFileUrl(req, brokerObj.kycDocs.aadharBack);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.panFront) {
        brokerObj.kycDocs.panFront = getFileUrl(req, brokerObj.kycDocs.panFront);
      }
      if (brokerObj.kycDocs.panBack) {
        brokerObj.kycDocs.panBack = getFileUrl(req, brokerObj.kycDocs.panBack);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, `Broker verification status updated to ${verificationStatus}`, { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};
