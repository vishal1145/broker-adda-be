import Region from '../models/Region.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

// Get all regions with filter and pagination
export const getAllRegions = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
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

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Get total count for pagination
    const totalRegions = await Region.countDocuments(filterQuery);

    // Get regions with filter, sort, and pagination
    const regions = await Region.find(filterQuery)
      .select('-__v')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    // Calculate pagination info
    const totalPages = Math.ceil(totalRegions / limitNum);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return successResponse(res, 'Regions retrieved successfully', {
      regions,
      pagination: {
        currentPage: parseInt(page),
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
    if (centerLocation) region.centerLocation = centerLocation;
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
    // Get total regions count
    const totalRegions = await Region.countDocuments();

    // Get unique states count
    const uniqueStates = await Region.distinct('state');
    const activeStates = uniqueStates.length;

    // Get unique cities count
    const uniqueCities = await Region.distinct('city');
    const activeCities = uniqueCities.length;

    // Get average brokers per region
    const regionsWithBrokers = await Region.aggregate([
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
          brokerCount: { $size: '$brokers' }
        }
      }
    ]);

    const totalBrokers = regionsWithBrokers.reduce((sum, region) => sum + region.brokerCount, 0);
    const avgBrokersPerRegion = totalRegions > 0 ? Math.round(totalBrokers / totalRegions) : 0;

    return successResponse(res, 'Region statistics retrieved successfully', {
      totalRegions,
      activeStates,
      activeCities,
      avgBrokersPerRegion,
      totalBrokers
    });
  } catch (error) {
    return serverError(res, error);
  }
};