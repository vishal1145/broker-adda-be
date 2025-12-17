import EmailSubscription from '../models/EmailSubscription.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

export const subscribeEmail = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate required fields
    if (!email) {
      return errorResponse(res, 'Email is required', 400);
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return errorResponse(res, 'Please enter a valid email address', 400);
    }

    // Check if email already exists
    const existingSubscription = await EmailSubscription.findOne({ email: email.toLowerCase() });

    if (existingSubscription) {
      return successResponse(res, 'Email is already subscribed', {
        email: existingSubscription.email,
        status: existingSubscription.status
      });
    }

    // Create new subscription
    const subscription = new EmailSubscription({
      email: email.toLowerCase(),
      status: 'active'
    });

    await subscription.save();

    return successResponse(res, 'Email subscribed successfully', {
      email: subscription.email,
      status: subscription.status
    }, 201);
  } catch (error) {
    // Handle duplicate key error (unique email constraint)
    if (error.code === 11000) {
      return errorResponse(res, 'Email is already subscribed', 409);
    }
    return serverError(res, error);
  }
};

export const getSubscriptions = async (req, res) => {
  try {
    const {
      page,
      limit,
      search,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.email = { $regex: search, $options: 'i' };
    }

    const pageNum = Number.isFinite(parseInt(page)) && parseInt(page) > 0 ? parseInt(page) : 1;
    const limitNum = Number.isFinite(parseInt(limit)) && parseInt(limit) > 0 ? parseInt(limit) : 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [items, total] = await Promise.all([
      EmailSubscription.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      EmailSubscription.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return successResponse(res, 'Subscriptions retrieved successfully', {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1
    });
  } catch (error) {
    return serverError(res, error);
  }
};


