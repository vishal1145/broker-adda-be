import PropertyRating from '../models/PropertyRating.js';
import Property from '../models/Property.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import mongoose from 'mongoose';

// Create/Save property rating
export const createPropertyRating = async (req, res) => {
  try {
    // Get propertyId from route params (nested route) or request body
    const propertyId = req.params.propertyId || req.body.propertyId;
    const { rating, review } = req.body;
    
    if (!propertyId) {
      return errorResponse(res, 'Property ID is required', 400);
    }
    
    // Get userId from authenticated user (the customer who is rating)
    const userId = req.user?._id;
    if (!userId) {
      return errorResponse(res, 'User authentication required', 401);
    }

    // Verify property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return errorResponse(res, 'Property not found', 404);
    }

    // Check if rating already exists (update if exists, create if not)
    let propertyRating = await PropertyRating.findOne({ propertyId, userId });

    if (propertyRating) {
      // Update existing rating
      propertyRating.rating = rating;
      propertyRating.review = review || propertyRating.review;
      await propertyRating.save();
      
      return successResponse(
        res,
        'Property rating updated successfully',
        propertyRating,
        200
      );
    } else {
      // Create new rating
      propertyRating = new PropertyRating({
        propertyId,
        userId,
        rating,
        review: review || undefined
      });
      await propertyRating.save();
      
      return successResponse(
        res,
        'Property rating saved successfully',
        propertyRating,
        201
      );
    }
  } catch (error) {
    if (error.code === 11000) {
      return errorResponse(res, 'You have already rated this property', 409);
    }
    return serverError(res, error);
  }
};

// Get ratings for a specific property
export const getPropertyRatings = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Verify property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return errorResponse(res, 'Property not found', 404);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const ratings = await PropertyRating.find({ propertyId })
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PropertyRating.countDocuments({ propertyId });

    // Calculate average rating
    const ratingStats = await PropertyRating.aggregate([
      { $match: { propertyId: new mongoose.Types.ObjectId(propertyId) } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 },
          ratingDistribution: {
            $push: '$rating'
          }
        }
      }
    ]);

    const stats = ratingStats[0] || {
      averageRating: null,
      totalRatings: 0,
      ratingDistribution: []
    };

    // Calculate rating distribution
    const distribution = {
      5: stats.ratingDistribution.filter(r => r === 5).length,
      4: stats.ratingDistribution.filter(r => r === 4).length,
      3: stats.ratingDistribution.filter(r => r === 3).length,
      2: stats.ratingDistribution.filter(r => r === 2).length,
      1: stats.ratingDistribution.filter(r => r === 1).length
    };

    // If no ratings exist, use default rating of 4
    const hasRatings = stats.totalRatings > 0;
    const averageRating = hasRatings 
      ? Math.round(stats.averageRating * 10) / 10 
      : 4;

    return successResponse(res, 'Property ratings retrieved successfully', {
      ratings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: {
        averageRating,
        totalRatings: stats.totalRatings,
        distribution,
        isDefaultRating: !hasRatings
      }
    });
  } catch (error) {
    return serverError(res, error);
  }
};

// Get user's rating for a specific property
export const getUserRatingForProperty = async (req, res) => {
  try {
    const { propertyId } = req.params;
    
    // Get userId from authenticated user
    const userId = req.user?._id;
    if (!userId) {
      return errorResponse(res, 'User authentication required', 401);
    }

    const rating = await PropertyRating.findOne({ propertyId, userId })
      .populate('propertyId', 'title address price images')
      .populate('userId', 'name email phone');

    if (!rating) {
      return successResponse(res, 'No rating found for this property', null, 200);
    }

    return successResponse(res, 'Rating retrieved successfully', rating);
  } catch (error) {
    return serverError(res, error);
  }
};

// Get all properties with their average ratings
export const getAllPropertyAverageRatings = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all properties with pagination
    const properties = await Property.find()
      .select('_id title address city propertyType price status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalProperties = await Property.countDocuments();

    // Get all property IDs
    const propertyIds = properties.map(p => p._id);

    // Get average ratings for all properties
    const ratingStats = propertyIds.length > 0 ? await PropertyRating.aggregate([
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
    for (const r of ratingStats) {
      const key = String(r._id);
      propertyIdToRating.set(key, {
        rating: Math.round(r.averageRating * 10) / 10,
        totalRatings: r.totalRatings,
        isDefaultRating: false
      });
    }

    // Attach ratings to properties (default 4 if no ratings)
    const propertiesWithRatings = properties.map(property => {
      const key = String(property._id);
      const ratingInfo = propertyIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
      return {
        ...property,
        rating: ratingInfo.rating,
        totalRatings: ratingInfo.totalRatings,
        isDefaultRating: ratingInfo.isDefaultRating
      };
    });

    return successResponse(res, 'All property average ratings retrieved successfully', {
      properties: propertiesWithRatings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalProperties / parseInt(limit)),
        totalProperties,
        hasNextPage: parseInt(page) < Math.ceil(totalProperties / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

