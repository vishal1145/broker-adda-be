import SavedProperty from '../models/SavedProperty.js';
import Property from '../models/Property.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';
import mongoose from 'mongoose';

/**
 * Save a property for the authenticated user
 */
export const saveProperty = async (req, res) => {
  try {
    const userId = req.user._id;
    const { propertyId } = req.body;

    if (!propertyId) {
      return errorResponse(res, 'propertyId is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return errorResponse(res, 'Invalid propertyId format', 400);
    }

    // Check if property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return errorResponse(res, 'Property not found', 404);
    }

    // Check if already saved
    const existing = await SavedProperty.findOne({ userId, propertyId });
    if (existing) {
      return errorResponse(res, 'Property is already saved', 409);
    }

    // Save the property
    const savedProperty = await SavedProperty.create({
      userId,
      propertyId
    });

    return successResponse(res, 'Property saved successfully', {
      savedProperty: {
        _id: savedProperty._id,
        userId: savedProperty.userId,
        propertyId: savedProperty.propertyId,
        createdAt: savedProperty.createdAt
      }
    }, 201);

  } catch (error) {
    if (error.code === 11000) {
      return errorResponse(res, 'Property is already saved', 409);
    }
    return serverError(res, error);
  }
};

/**
 * Get all saved properties for the authenticated user
 */
export const getSavedProperties = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get saved properties with populated property data
    const savedProperties = await SavedProperty.find({ userId })
      .populate({
        path: 'propertyId',
        select: 'title description propertyDescription propertyType subType price priceUnit address city bedrooms bathrooms furnishing amenities nearbyAmenities features locationBenefits images videos broker region status isFeatured createdAt updatedAt',
        populate: [
          {
            path: 'broker',
            select: 'name email phone firmName licenseNumber status brokerImage'
          },
          {
            path: 'region',
            select: 'name description city state centerLocation radius'
          }
        ]
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Filter out any saved properties where property was deleted
    const validSavedProperties = savedProperties.filter(sp => sp.propertyId !== null);

    // Process property images URLs
    const processedProperties = validSavedProperties.map(sp => {
      const property = sp.propertyId;
      if (property && property.images) {
        property.images = property.images.map(img => {
          if (img && !img.startsWith('http')) {
            return getFileUrl(req, img);
          }
          return img;
        });
      }
      if (property && property.videos) {
        property.videos = property.videos.map(vid => {
          if (vid && !vid.startsWith('http')) {
            return getFileUrl(req, vid);
          }
          return vid;
        });
      }
      if (property?.broker?.brokerImage && !property.broker.brokerImage.startsWith('http')) {
        property.broker.brokerImage = getFileUrl(req, property.broker.brokerImage);
      }
      return sp;
    });

    // Get total count
    const totalSaved = await SavedProperty.countDocuments({ userId });

    return successResponse(res, 'Saved properties retrieved successfully', {
      savedProperties: processedProperties,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalSaved / parseInt(limit)),
        totalSaved,
        hasNextPage: parseInt(page) < Math.ceil(totalSaved / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Remove a saved property
 */
export const removeSavedProperty = async (req, res) => {
  try {
    const userId = req.user._id;
    const { propertyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return errorResponse(res, 'Invalid propertyId format', 400);
    }

    const savedProperty = await SavedProperty.findOneAndDelete({
      userId,
      propertyId
    });

    if (!savedProperty) {
      return errorResponse(res, 'Saved property not found', 404);
    }

    return successResponse(res, 'Property removed from saved list', {
      removed: {
        _id: savedProperty._id,
        propertyId: savedProperty.propertyId
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Check if a property is saved by the user
 */
export const checkIfSaved = async (req, res) => {
  try {
    const userId = req.user._id;
    const { propertyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return errorResponse(res, 'Invalid propertyId format', 400);
    }

    const savedProperty = await SavedProperty.findOne({
      userId,
      propertyId
    });

    return successResponse(res, 'Check completed', {
      isSaved: !!savedProperty,
      savedProperty: savedProperty ? {
        _id: savedProperty._id,
        createdAt: savedProperty.createdAt
      } : null
    });

  } catch (error) {
    return serverError(res, error);
  }
};

/**
 * Get count of saved properties for the user
 */
export const getSavedPropertyCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const count = await SavedProperty.countDocuments({ userId });

    return successResponse(res, 'Saved property count retrieved', {
      count
    });

  } catch (error) {
    return serverError(res, error);
  }
};

