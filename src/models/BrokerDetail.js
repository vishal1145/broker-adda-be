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
    match: [/^\+?[1-9]\d{1,14}$/, 'Please enter a valid WhatsApp number']
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: true
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
    enum: ['active', 'inactive'],
    default: 'inactive'
  },
  approvedByAdmin: {
    type: String,
    enum: ['blocked', 'unblocked'],
    default: 'unblocked'
  },
  adminNotes: {
    type: String,
    maxlength: [500, 'Admin notes cannot be more than 500 characters']
  }
}, {
  timestamps: true
});

export default mongoose.model('BrokerDetail', brokerDetailSchema);
