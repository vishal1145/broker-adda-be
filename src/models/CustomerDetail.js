import mongoose from 'mongoose';

const customerDetailSchema = new mongoose.Schema({
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
  preferences: {
    budgetMin: {
      type: Number,
      min: [0, 'Budget cannot be negative']
    },
    budgetMax: {
      type: Number,
      min: [0, 'Budget cannot be negative']
    },
    propertyType: [{
      type: String,
      enum: ['apartment', 'villa', 'plot', 'commercial', 'house']
    }],
    region: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region'
    }]
  },
  savedSearches: [{
    type: {
      type: String,
      required: true
    },
    budgetMax: {
      type: Number,
      required: true
    },
    budgetMin: {
      type: Number,
      default: 0
    },
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  inquiryCount: {
    type: Number,
    default: 0
  },
  // Image file paths for customer
  images: {
    customerImage: {
      type: String,
      default: null
    }
  }
}, {
  timestamps: true
});

export default mongoose.model('CustomerDetail', customerDetailSchema);
