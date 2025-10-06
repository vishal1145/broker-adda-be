import BrokerDetail from '../models/BrokerDetail.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Region from '../models/Region.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';
import { updateRegionBrokerCount, updateMultipleRegionBrokerCounts } from '../utils/brokerCount.js';

// Get all brokers (with pagination and filtering) - All roles allowed
export const getAllBrokers = async (req, res) => {
  try {
    const { 
      page , 
      limit , 
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
      filter.approvedByAdmin = approvedByAdmin;
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
        { whatsappNumber: { $regex: search, $options: 'i' } },
        { firmName: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { website: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get brokers with populated region data
    const brokers = await BrokerDetail.find(filter)
      .populate('region', 'name description city state centerLocation radius')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalBrokers = await BrokerDetail.countDocuments(filter);
    const totalPages = Math.ceil(totalBrokers / parseInt(limit));

    // Get blocked and unblocked counts (without filters for overall stats)
    const totalBlockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'blocked' });
    const totalUnblockedBrokers = await BrokerDetail.countDocuments({ approvedByAdmin: 'unblocked' });

    // Prepare lead stats for each broker
    const brokerIds = brokers.map(b => b._id);
    const [leadCountsAgg, leadsBasic] = await Promise.all([
      Lead.aggregate([
        { $match: { createdBy: { $in: brokerIds } } },
        { $group: { _id: '$createdBy', count: { $sum: 1 } } }
      ]),
      Lead.find({ createdBy: { $in: brokerIds } })
        .select('customerName customerEmail customerPhone createdBy')
        .lean()
    ]);
    const brokerIdToLeadCount = new Map(leadCountsAgg.map(x => [String(x._id), x.count]));
    const brokerIdToLeads = new Map();
    for (const l of leadsBasic) {
      const key = String(l.createdBy);
      if (!brokerIdToLeads.has(key)) brokerIdToLeads.set(key, []);
      brokerIdToLeads.get(key).push({
        _id: l._id,
        customerName: l.customerName,
        customerEmail: l.customerEmail,
        customerPhone: l.customerPhone
      });
    }

    // Convert file paths to URLs and attach lead stats
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
        if (brokerObj.kycDocs.brokerLicense) {
          brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
        }
        if (brokerObj.kycDocs.companyId) {
          brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
        }
      }
      
      // Convert broker image path to URL
      if (brokerObj.brokerImage) {
        brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
      }

      // Attach lead stats
      const key = String(brokerObj._id);
      brokerObj.leadsCreated = {
        count: brokerIdToLeadCount.get(key) || 0,
        items: brokerIdToLeads.get(key) || []
      };
      
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
      },
      stats: {
        totalBlockedBrokers,
        totalUnblockedBrokers,
        totalAllBrokers: totalBlockedBrokers + totalUnblockedBrokers
      }
    });

  } catch (error) {
    console.error('Error in getAllBrokers:', error);
    return serverError(res, error);
  }
};

// Get single broker details by userId
export const getBrokerById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find broker by userId instead of _id
    const broker = await BrokerDetail.findOne({ userId: id })
      .populate('region', 'name description city state centerLocation radius')
      .populate('userId', 'name email phone status');

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
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    // Lead stats for this broker
    const [leadCount, leads] = await Promise.all([
      Lead.countDocuments({ createdBy: broker._id }),
      Lead.find({ createdBy: broker._id })
        .select('customerName customerEmail customerPhone')
        .lean()
    ]);
    brokerObj.leadsCreated = {
      count: leadCount,
      items: leads
    };

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
    broker.approvedByAdmin = 'unblocked';
    await broker.save();

    // Update user status to active if it was pending
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { status: 'active' });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description name description city state centerLocation radius');

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
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker unblocked successfully', { 
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
    broker.approvedByAdmin = 'blocked';
    await broker.save();

    // Update user status to suspended if needed
    if (broker.userId) {
      await User.findByIdAndUpdate(broker.userId, { 
        status: 'inactive' 
      });
    }

    // Update broker count for assigned regions
    if (broker.region && broker.region.length > 0) {
      await updateMultipleRegionBrokerCounts(broker.region);
    }

    // Get updated broker with populated data
    const updatedBroker = await BrokerDetail.findById(id)
      .populate('region', 'name description city state centerLocation radius');

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
      if (brokerObj.kycDocs.brokerLicense) {
        brokerObj.kycDocs.brokerLicense = getFileUrl(req, brokerObj.kycDocs.brokerLicense);
      }
      if (brokerObj.kycDocs.companyId) {
        brokerObj.kycDocs.companyId = getFileUrl(req, brokerObj.kycDocs.companyId);
      }
    }
    
    // Convert broker image path to URL
    if (brokerObj.brokerImage) {
      brokerObj.brokerImage = getFileUrl(req, brokerObj.brokerImage);
    }

    return successResponse(res, 'Broker blocked successfully', { 
      broker: brokerObj 
    });

  } catch (error) {
    return serverError(res, error);
  }
};


