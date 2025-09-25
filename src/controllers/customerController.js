import CustomerDetail from '../models/CustomerDetail.js';
import User from '../models/User.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';

// Get all customers - works for any role (admin, broker, customer)
export const getAllCustomers = async (req, res) => {
  try {
    const { page, limit , search = '' } = req.query;
    const skip = (page - 1) * limit;

    // Build search query for users
    let searchQuery = { role: 'customer' };
    if (search) {
      searchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    // Get all users with customer role
    const customers = await User.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCustomers = await User.countDocuments(searchQuery);

    // Get customer details for each customer
    const responseData = await Promise.all(customers.map(async (customer) => {
      const data = {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        role: customer.role,
        status: customer.status,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      };

      // Get customer details if available
      const customerDetail = await CustomerDetail.findOne({ userId: customer._id })
        .populate('preferences.region', 'name description')
        .populate('savedSearches.region', 'name description');

      if (customerDetail) {
        data.gender = customerDetail.gender;
        data.preferences = customerDetail.preferences;
        data.savedSearches = customerDetail.savedSearches;
        data.inquiryCount = customerDetail.inquiryCount;
        data.images = customerDetail.images;

        if (customerDetail.images && customerDetail.images.customerImage) {
          data.files = {
            customerImage: getFileUrl(req, customerDetail.images.customerImage)
          };
        }
      }

      return data;
    }));

    return successResponse(res, 'Customers retrieved successfully', {
      customers: responseData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCustomers / limit),
        totalCustomers,
        hasNextPage: page < Math.ceil(totalCustomers / limit),
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Get customer by ID - works for any role (admin, broker, customer)
export const getCustomerById = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Get customer user
    const customer = await User.findById(customerId);
    
    if (!customer || customer.role !== 'customer') {
      return errorResponse(res, 'Customer not found', 404);
    }

    // Get customer details
    const customerDetail = await CustomerDetail.findOne({ userId: customerId })
      .populate('preferences.region', 'name description')
      .populate('savedSearches.region', 'name description');

    const responseData = {
      _id: customer._id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      role: customer.role,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    };

    // Add customer details if available
    if (customerDetail) {
      responseData.gender = customerDetail.gender;
      responseData.preferences = customerDetail.preferences;
      responseData.savedSearches = customerDetail.savedSearches;
      responseData.inquiryCount = customerDetail.inquiryCount;
      responseData.images = customerDetail.images;

      if (customerDetail.images && customerDetail.images.customerImage) {
        responseData.files = {
          customerImage: getFileUrl(req, customerDetail.images.customerImage)
        };
      }
    }

    return successResponse(res, 'Customer retrieved successfully', {
      customer: responseData
    });

  } catch (error) {
    return serverError(res, error);
  }
};

