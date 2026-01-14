import PropertyAd from "../models/propertyAd.js";

const createPropertyAd = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Request body is required"
      });
    }

    const {
      title,
      price,
      bhk,
      city,
      locality,
      propertyType,
      areaSqft,
      maxImpressions,
      status
    } = req.body;

    if (!title || !price || !bhk || !city || !locality || !propertyType) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: title, price, bhk, city, locality, propertyType"
      });
    }

    // 📸 media
    const mediaFiles = req.files?.map(file => file.path) || [];

    // 📍 placement
    let placement = {
      homePage: false,
      searchPage: false,
      sidebar: false,
      brokerProfile: false,
      enquiryPage: false
    };

    if (req.body.placement) {
      placement = JSON.parse(req.body.placement);
    }

    // ✅ CTA FIX
    let cta = {
      type: "CALL",
      phone: null
    };

    if (req.body.cta) {
      cta = JSON.parse(req.body.cta);
    }

    const ad = await PropertyAd.create({
      title,
      price,
      bhk,
      areaSqft,
      city,
      locality,
      propertyType,
      media: mediaFiles,
      placement,
      cta, // ✅ IMPORTANT
      maxImpressions: maxImpressions || 5000,
      status: status || "draft"
    });

    return res.status(201).json({
      success: true,
      message: "Property Ad created successfully",
      data: ad
    });

  } catch (err) {
    console.error("Create Property Ad Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



const getAllAds = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [ads, total] = await Promise.all([
      PropertyAd.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      PropertyAd.countDocuments()
    ]);

    res.json({
      success: true,
      data: ads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// GET single property ad (VIEW)
const getAdById = async (req, res) => {
  try {
    const { id } = req.params;

    const ad = await PropertyAd.findById(id);

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Property Ad not found"
      });
    }

    return res.json({
      success: true,
      data: ad
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


const updatePropertyAd = async (req, res) => {
  try {
    let placement;
    if (req.body.placement) {
      placement = JSON.parse(req.body.placement);
    }

    const updateData = {
      ...req.body,
      ...(placement && { placement })
    };

    if (req.files?.length) {
      updateData.media = req.files.map(file => file.path);
    }

    const ad = await PropertyAd.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Property Ad not found"
      });
    }

    return res.json({
      success: true,
      message: "Property Ad updated successfully",
      data: ad
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


const deletePropertyAd = async (req, res) => {
  try {
    const ad = await PropertyAd.findByIdAndDelete(req.params.id);

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Property Ad not found"
      });
    }

    return res.json({
      success: true,
      message: "Property Ad deleted successfully"
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

export { createPropertyAd, getAllAds,getAdById, updatePropertyAd, deletePropertyAd };