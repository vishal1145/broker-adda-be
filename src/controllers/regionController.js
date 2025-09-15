import Region from '../models/Region.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

// Get all regions
export const getAllRegions = async (req, res) => {
  try {
    const regions = await Region.find().select('-__v');
    return successResponse(res, 'Regions retrieved successfully', { regions });
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