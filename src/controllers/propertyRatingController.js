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
      averageRating: 0,
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

    return successResponse(res, 'Property ratings retrieved successfully', {
      ratings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: {
        averageRating: Math.round(stats.averageRating * 10) / 10,
        totalRatings: stats.totalRatings,
        distribution
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

