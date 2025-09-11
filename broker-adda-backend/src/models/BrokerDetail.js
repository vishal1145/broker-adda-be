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
  firmName: {
    type: String,
    trim: true,
    maxlength: [100, 'Firm name cannot be more than 100 characters']
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
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'inactive'
  },
  approvedByAdmin: {
    type: Boolean,
    default: false
  },
  adminNotes: {
    type: String,
    maxlength: [500, 'Admin notes cannot be more than 500 characters']
  }
}, {
  timestamps: true
});

export default mongoose.model('BrokerDetail', brokerDetailSchema);
