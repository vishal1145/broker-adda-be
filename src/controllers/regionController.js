import Region from '../models/Region.js';
import BrokerDetail from '../models/BrokerDetail.js';
import mongoose from 'mongoose';
import { geocodeAddress } from '../utils/geocode.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

// Get all regions with filter and pagination
export const getAllRegions = async (req, res) => {
  try {
    const { 
      page , 
      limit , 
      search = '', 
      state = '', 
      city = '',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // Build filter query
    let filterQuery = {};
    
    // Search filter (searches in name, description, state, city)
    if (search) {
      filterQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
    }
    
    // State filter
    if (state) {
      filterQuery.state = { $regex: state, $options: 'i' };
    }
    
    // City filter
    if (city) {
      filterQuery.city = { $regex: city, $options: 'i' };
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Calculate pagination (safe defaults)
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalRegions = await Region.countDocuments(filterQuery);

    // Get regions with per-region broker counts (brokers referencing this region)
    const regions = await Region.aggregate([
      { $match: filterQuery },
      {
        $lookup: {
          from: 'brokerdetails',
          localField: '_id',
          foreignField: 'region',
          as: 'brokers'
        }
      },
      {
        $addFields: {
          brokerCount: { $size: '$brokers' }
        }
      },
      {
        $project: {
          __v: 0,
          brokers: 0
        }
      },
      { $sort: sortObj },
      { $skip: skip },
      { $limit: limitNum }
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalRegions / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return successResponse(res, 'Regions retrieved successfully', {
      regions,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRegions,
        limit: limitNum,
        hasNextPage,
        hasPrevPage
      },
      filters: {
        search,
        state,
        city,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    return serverError(res, error);
  }
};

// Get region by ID
export const getRegionById = async (req, res) => {
  try {
    const { id } = req.params;
    const region = await Region.findById(id).select('-__v');
    if (!region) {
      return errorResponse(res, 'Region not found', 404);
    }
    return successResponse(res, 'Region retrieved successfully', { region });
  } catch (error) {
    return serverError(res, error);
  }
};

// Create new region
export const createRegion = async (req, res) => {
  try {
    const { name, description, state, city, centerLocation, radius } = req.body;
    
    const existingRegion = await Region.findOne({ name });
    if (existingRegion) {
      return errorResponse(res, 'Region with this name already exists', 400);
    }
    
    const region = new Region({ 
      name, 
      description, 
      state, 
      city, 
      centerLocation, 
      radius 
    });

    // Compute coordinates from centerLocation (address only)
    const coords = await geocodeAddress(centerLocation);
    if (coords) {
      region.centerCoordinates = [coords.lat, coords.lng]; // [lat, lng]
    }
    await region.save();
    
    return successResponse(res, 'Region created successfully', { region }, 201);
  } catch (error) {
    return serverError(res, error);
  }
};

// Update region
export const updateRegion = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, state, city, centerLocation, radius } = req.body;
    
    const region = await Region.findById(id);
    if (!region) {
      return errorResponse(res, 'Region not found', 404);
    }
    
    if (name && name !== region.name) {
      const existingRegion = await Region.findOne({ name, _id: { $ne: id } });
      if (existingRegion) {
        return errorResponse(res, 'Region with this name already exists', 400);
      }
    }
    
    if (name) region.name = name;
    if (description !== undefined) region.description = description;
    if (state) region.state = state;
    if (city) region.city = city;
    if (centerLocation) {
      region.centerLocation = centerLocation;
      // Recompute coordinates when address changes
      const coords = await geocodeAddress(centerLocation);
      if (coords) {
        region.centerCoordinates = [coords.lat, coords.lng]; // [lat, lng]
      }
    }
    if (radius !== undefined) region.radius = radius;
    
    await region.save();
    return successResponse(res, 'Region updated successfully', { region });
  } catch (error) {
    return serverError(res, error);
  }
};

// Delete region
export const deleteRegion = async (req, res) => {
  try {
    const { id } = req.params;
    const region = await Region.findByIdAndDelete(id);
    if (!region) {
      return errorResponse(res, 'Region not found', 404);
    }
    return successResponse(res, 'Region deleted successfully');
  } catch (error) {
    return serverError(res, error);
  }
};

// Get region statistics/counts
export const getRegionStats = async (req, res) => {
  try {
    // Optional filters for regions
    const { regionId, state, city } = req.query || {};

    const regionMatch = {};
    if (regionId) {
      const ids = String(regionId)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        regionMatch._id = { $in: ids.map(id => new mongoose.Types.ObjectId(id)) };
      }
    }
    if (state) regionMatch.state = { $regex: state, $options: 'i' };
    if (city) regionMatch.city = { $regex: city, $options: 'i' };

    // Get total regions count (after filters)
    const totalRegions = await Region.countDocuments(regionMatch);

    // Get unique states count
    const uniqueStates = await Region.distinct('state', regionMatch);
    const activeStates = uniqueStates.length;

    // Get unique cities count
    const uniqueCities = await Region.distinct('city', regionMatch);
    const activeCities = uniqueCities.length;

    // Get per-region broker counts (all brokers regardless of status/approval)
    const regionsWithBrokers = await Region.aggregate([
      { $match: regionMatch },
      {
        $lookup: {
          from: 'brokerdetails',
          localField: '_id',
          foreignField: 'region',
          as: 'brokers'
        }
      },
      {
        $project: {
          name: 1,
          brokerCount: { $size: '$brokers' },
          state: 1,
          city: 1
        }
      }
    ]);

    // Compute total brokers
    // - If no region filters are applied, count all brokers in the system
    // - If region filters are applied, count brokers linked to those regions
    const hasRegionFilters = Boolean(regionMatch._id || regionMatch.state || regionMatch.city);
    let totalBrokers = 0;
    if (!hasRegionFilters) {
      totalBrokers = await BrokerDetail.countDocuments({});
    } else if (totalRegions > 0) {
      const regionIds = (await Region.find(regionMatch).select('_id').lean()).map(r => r._id);
      totalBrokers = regionIds.length > 0
        ? await BrokerDetail.countDocuments({ region: { $in: regionIds } })
        : 0;
    }
    const avgBrokersPerRegion = totalRegions > 0 ? Math.round(totalBrokers / totalRegions) : 0;

    return successResponse(res, 'Region statistics retrieved successfully', {
      totalRegions,
      activeStates,
      activeCities,
      avgBrokersPerRegion,
      totalBrokers,
      regions: regionsWithBrokers
    });
  } catch (error) {
    return serverError(res, error);
  }
};

// Haversine distance in kilometers
function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Find nearest regions to a broker or given coordinates
export const getNearestRegions = async (req, res) => {
  try {
    const { brokerId, latitude, longitude, limit = 5 } = req.query;

    let lat;
    let lng;

    if (brokerId) {
      const broker = await BrokerDetail.findById(brokerId).lean();
      if (!broker || !broker.location?.coordinates || broker.location.coordinates.length !== 2) {
        return errorResponse(res, 'Broker coordinates not found', 404);
      }
      // Stored as [lat, lng]
      [lat, lng] = broker.location.coordinates;
    } else if (latitude && longitude) {
      lat = parseFloat(latitude);
      lng = parseFloat(longitude);
    } else {
      return errorResponse(res, 'Provide brokerId or latitude and longitude', 400);
    }

    // Fetch regions that have centerCoordinates
    const regions = await Region.find({ centerCoordinates: { $exists: true, $ne: undefined } }).select('-__v').lean();

    const withDistance = regions
      .filter(r => Array.isArray(r.centerCoordinates) && r.centerCoordinates.length === 2)
      .map(r => {
        const [rLat, rLng] = r.centerCoordinates; // [lat, lng]
        const distanceKm = calculateDistanceKm(lat, lng, rLat, rLng);
        return { ...r, distanceKm: Number(distanceKm.toFixed(3)) };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, Number(limit) || 5);

    return successResponse(res, 'Nearest regions retrieved successfully', { 
      origin: { lat, lng },
      regions: withDistance 
    });
  } catch (error) {
    return serverError(res, error);
  }
};