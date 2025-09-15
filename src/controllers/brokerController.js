import BrokerDetail from '../models/BrokerDetail.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';

// Get all brokers (with pagination and filtering) - All roles allowed
export const getAllBrokers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      approvedByAdmin, 
      regionId,
      search 
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (approvedByAdmin !== undefined) {
      filter.approvedByAdmin = approvedByAdmin === 'true';
    }
    
    if (regionId) {
      filter.region = regionId;
    }

    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { firmName: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get brokers with populated region data
    const brokers = await BrokerDetail.find(filter)
      .populate('region', 'name description')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalBrokers = await BrokerDetail.countDocuments(filter);
    const totalPages = Math.ceil(totalBrokers / parseInt(limit));

    // Convert file paths to URLs
    const brokersWithUrls = brokers.map(broker => {
      const brokerObj = broker.toObject();
      
      // Convert kycDocs file paths to URLs
      if (brokerObj.kycDocs) {
        if (brokerObj.kycDocs.aadhar) {
          brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
        }
        if (brokerObj.kycDocs.pan) {
          brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
        }
        if (brokerObj.kycDocs.gst) {
          brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
        }
      }
      
      // Convert broker image path to URL
      if (brokerObj.brokerImage) {
        brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
      }
      
      return brokerObj;
    });

    return successResponse(res, 'Brokers retrieved successfully', {
      brokers: brokersWithUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalBrokers,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error in getAllBrokers:', error);
    return serverError(res, error);
  }
};

// Get single broker details for admin
export const getBrokerById = async (req, res) => {
  try {
    const { id } = req.params;

    const broker = await BrokerDetail.findById(id)
      .populate('region', 'name description');

    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Convert file paths to URLs
    const brokerObj = broker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker details retrieved successfully', { broker: brokerObj });

  } catch (error) {
    return serverError(res, error);
  }
};

// Approve broker
export const approveBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker approval status
    broker.approvedByAdmin = true;
    await broker.save();

    // Update user status to active if it was pending
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { status: 'active' });
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description');

    // Convert file paths to URLs
    const brokerObj = updatedBroker.toObject();
    
    // Convert kycDocs file paths to URLs
    if (brokerObj.kycDocs) {
      if (brokerObj.kycDocs.aadhar) {
        brokerObj.kycDocs.aadhar = getFileUrl(req, brokerObj.kycDocs.aadhar);
      }
      if (brokerObj.kycDocs.pan) {
        brokerObj.kycDocs.pan = getFileUrl(req, brokerObj.kycDocs.pan);
      }
      if (brokerObj.kycDocs.gst) {
        brokerObj.kycDocs.gst = getFileUrl(req, brokerObj.kycDocs.gst);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker approved successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Reject broker
export const rejectBroker = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker
    const broker = await BrokerDetail.findById(id);
    
    if (!broker) {
      return errorResponse(res, 'Broker not found', 404);
    }

    // Update broker rejection status
    broker.approvedByAdmin = false;
    await broker.save();

    // Update user status to suspended if needed
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { 
        status: 'inactive' 
      });
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description');

    return successResponse(res, 'Broker rejected successfully', { 
      broker: updatedBroker 
    });

  } catch (error) {
    return serverError(res, error);
  }
};

