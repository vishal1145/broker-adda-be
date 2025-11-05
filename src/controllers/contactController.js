import Contact from '../models/Contact.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';

export const createContact = async (req, res) => {
  try {
    const { fullName, email, message } = req.body;

    // Validate required fields
    if (!fullName || !email || !message) {
      return errorResponse(res, 'Full name, email, and message are required', 400);
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return errorResponse(res, 'Please enter a valid email address', 400);
    }

    const contact = new Contact({
      fullName,
      email,
      message,
      status: 'new'
    });

    await contact.save();

    return successResponse(res, 'Contact form submitted successfully', { contact }, 201);
  } catch (error) {
    return serverError(res, error);
  }
};

export const getContacts = async (req, res) => {
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
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = Number.isFinite(parseInt(page)) && parseInt(page) > 0 ? parseInt(page) : 1;
    const limitNum = Number.isFinite(parseInt(limit)) && parseInt(limit) > 0 ? parseInt(limit) : 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [items, total] = await Promise.all([
      Contact.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Contact.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return successResponse(res, 'Contacts retrieved successfully', {
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

