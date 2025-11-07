import BrokerRating from '../models/BrokerRating.js';
import BrokerDetail from '../models/BrokerDetail.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import mongoose from 'mongoose';

// Create/Save broker rating
export const createBrokerRating = async (req, res) => {
  try {
    // Get brokerId from route params (nested route) or request body
    const brokerId = req.params.brokerId || req.body.brokerId;
    const { rating, review } = req.body;
    
    if (!brokerId) {
      return errorResponse(res, 'Broker ID is required', 400);
    }
    
    // Get userId from authenticated user (the customer who is rating)
    const userId = req.user?._id;
    if (!userId) {
      return errorResponse(res, 'User authentication required', 401);
    }

    // Verify broker exists
    const broker = await BrokerDetail.findById(brokerId);
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Check if rating already exists (update if exists, create if not)
    let brokerRating = await BrokerRating.findOne({ brokerId, userId });

    if (brokerRating) {
      // Update existing rating
      brokerRating.rating = rating;
      brokerRating.review = review || brokerRating.review;
      await brokerRating.save();
      
      return successResponse(
        res,
        'Broker rating updated successfully',
        brokerRating,
        200
      );
    } else {
      // Create new rating
      brokerRating = new BrokerRating({
        brokerId,
        userId,
        rating,
        review: review || undefined
      });
      await brokerRating.save();
      
      return successResponse(
        res,
        'Broker rating saved successfully',
        brokerRating,
        201
      );
    }
  } catch (error) {
    if (error.code === 11000) {
      return errorResponse(res, 'You have already rated this broker', 409);
    }
    return serverError(res, error);
  }
};

// Get ratings for a specific broker
export const getBrokerRatings = async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Verify broker exists
    const broker = await BrokerDetail.findById(brokerId);
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const ratings = await BrokerRating.find({ brokerId })
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BrokerRating.countDocuments({ brokerId });

    // Calculate average rating
    const ratingStats = await BrokerRating.aggregate([
      { $match: { brokerId: new mongoose.Types.ObjectId(brokerId) } },
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

    return successResponse(res, 'Broker ratings retrieved successfully', {
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

// Get user's rating for a specific broker
export const getCustomerRatingForBroker = async (req, res) => {
  try {
    const { brokerId } = req.params;
    
    // Get userId from authenticated user
    const userId = req.user?._id;
    if (!userId) {
      return errorResponse(res, 'User authentication required', 401);
    }

    const rating = await BrokerRating.findOne({ brokerId, userId })
      .populate('brokerId', 'name firmName images.brokerImage')
      .populate('userId', 'name email phone');

    if (!rating) {
      return successResponse(res, 'No rating found for this broker', null, 200);
    }

    return successResponse(res, 'Rating retrieved successfully', rating);
  } catch (error) {
    return serverError(res, error);
  }
};

// Get all brokers with their average ratings
export const getAllBrokerAverageRatings = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all brokers with pagination
    const brokers = await BrokerDetail.find()
      .select('_id name email phone firmName city state status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalBrokers = await BrokerDetail.countDocuments();

    // Get all broker IDs
    const brokerIds = brokers.map(b => b._id);

    // Get average ratings for all brokers
    const ratingStats = brokerIds.length > 0 ? await BrokerRating.aggregate([
      { $match: { brokerId: { $in: brokerIds } } },
      {
        $group: {
          _id: '$brokerId',
          averageRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]) : [];

    // Create rating map
    const brokerIdToRating = new Map();
    for (const r of ratingStats) {
      const key = String(r._id);
      brokerIdToRating.set(key, {
        rating: Math.round(r.averageRating * 10) / 10,
        totalRatings: r.totalRatings,
        isDefaultRating: false
      });
    }

    // Attach ratings to brokers (default 4 if no ratings)
    const brokersWithRatings = brokers.map(broker => {
      const key = String(broker._id);
      const ratingInfo = brokerIdToRating.get(key) || {
        rating: 4,
        totalRatings: 0,
        isDefaultRating: true
      };
      return {
        ...broker,
        rating: ratingInfo.rating,
        totalRatings: ratingInfo.totalRatings,
        isDefaultRating: ratingInfo.isDefaultRating
      };
    });

    return successResponse(res, 'All broker average ratings retrieved successfully', {
      brokers: brokersWithRatings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalBrokers / parseInt(limit)),
        totalBrokers,
        hasNextPage: parseInt(page) < Math.ceil(totalBrokers / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

