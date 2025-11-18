import mongoose from 'mongoose';

const brokerDetailSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    match: [/^\+?[1-9]\d{1,14}$/, 'Please enter a valid phone number']
  },
  whatsappNumber: {
    type: String,
    validate: {
      validator: function(v) {
        // Allow empty string, null, or undefined
        if (!v || v === '') return true;
        // If value exists, validate against pattern
        return /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: 'Please enter a valid WhatsApp number'
    }
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    
  },
  firmName: {
    type: String,
    trim: true,
    maxlength: [100, 'Firm name cannot be more than 100 characters']
  },
  licenseNumber: {
    type: String,
    trim: true,
    maxlength: [50, 'License number cannot be more than 50 characters']
  },
  address: {
    type: String,
    trim: true,
    maxlength: [500, 'Office address cannot be more than 500 characters']
  },
  // GeoJSON location for geospatial queries (always [lng, lat])
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: undefined,
      validate: {
        validator: (v) => !v || v.length === 2,
        message: 'Coordinates must be [longitude, latitude]'
      }
    }
  },
  state: {
    type: String,
    trim: true,
    maxlength: [50, 'State cannot be more than 50 characters']
  },
  city: {
    type: String,
    trim: true,
    maxlength: [50, 'City cannot be more than 50 characters']
  },
  specializations: [{
    type: String,
    trim: true,
    maxlength: [100, 'Each specialization cannot be more than 100 characters']
  }],
  website: {
    type: String,
    trim: true,
    maxlength: [200, 'Website URL cannot be more than 200 characters']
  },
  socialMedia: {
    linkedin: {
      type: String,
      trim: true,
      maxlength: [200, 'LinkedIn URL cannot be more than 200 characters']
    },
    twitter: {
      type: String,
      trim: true,
      maxlength: [200, 'Twitter URL cannot be more than 200 characters']
    },
    instagram: {
      type: String,
      trim: true,
      maxlength: [200, 'Instagram URL cannot be more than 200 characters']
    },
    facebook: {
      type: String,
      trim: true,
      maxlength: [200, 'Facebook URL cannot be more than 200 characters']
    }
  },
 region: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region'
    }],
  kycDocs: {
    aadhar: {
      type: String
    },
    pan: {
      type: String
    },
    gst: {
      type: String
    },
    brokerLicense: {
      type: String
    },
    companyId: {
      type: String
    }
  },
  // Broker image file path
  brokerImage: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive','online','busy'],
    default: 'active'
  },
  approvedByAdmin: {
    type: String,
    enum: ['blocked', 'unblocked'],
    default: 'unblocked'
  },
  // Verification status (default: Verified)
  verificationStatus: {
    type: String,
    enum: ['Verified', 'Unverified'],
    default: 'Verified'
  },
  // Optional realtime/availability status for brokers
  availabilityStatus: {
    type: String,
    enum: ['online', 'offline', 'active', 'busy']
  },
  // Broker rating (1-5 stars, default 4)
  rating: {
    type: Number,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5'],
    default: 4
  },
  adminNotes: {
    type: String,
    maxlength: [500, 'Admin notes cannot be more than 500 characters']
  },

  role: {
    type: String,
    enum: ['broker', 'customer'],
  },
  // New fields for broker content and experience
  content: {
    type: String,
    trim: true,
    maxlength: [2000, 'Content cannot be more than 2000 characters']
  },
  experience: {
    years: {
      type: Number,
      min: [0, 'Experience years cannot be negative'],
      max: [50, 'Experience years cannot be more than 50']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Experience description cannot be more than 1000 characters']
    },
    achievements: [{
      type: String,
      trim: true,
      maxlength: [200, 'Each achievement cannot be more than 200 characters']
    }],
    certifications: [{
      type: String,
      trim: true,
      maxlength: [200, 'Each certification cannot be more than 200 characters']
    }],
  }
}, {
  timestamps: true
});

// Geo index to enable "near me" queries
brokerDetailSchema.index({ location: '2dsphere' });

// Ensure we don't save invalid/partial GeoJSON
brokerDetailSchema.pre('save', function(next) {
  if (this.location) {
    const coords = this.location?.coordinates;
    const isValid = Array.isArray(coords) && coords.length === 2 &&
      coords.every(n => typeof n === 'number' && Number.isFinite(n));
    if (!isValid) {
      this.location = undefined;
    } else if (!this.location.type) {
      this.location.type = 'Point';
    }
  }
  
  // Set default rating if not provided
  if (this.rating === undefined || this.rating === null) {
    this.rating = 4;
  }
  
  // Set default verificationStatus if not provided
  if (this.verificationStatus === undefined || this.verificationStatus === null) {
    this.verificationStatus = 'Verified';
  }
  
  next();
});

export default mongoose.model('BrokerDetail', brokerDetailSchema);
